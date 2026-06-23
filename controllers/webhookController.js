/**
 * controllers/webhookController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * WhatsApp webhook controller.
 *
 * Responsibilities:
 *   - verifyWebhook()   : Handle GET requests from Meta for webhook verification
 *   - handleIncoming()  : Handle POST requests containing WhatsApp events
 *
 * Architecture rule:
 *   Controllers ONLY handle HTTP request/response concerns:
 *     • Extract data from req
 *     • Call services / utils
 *     • Send res
 *   All business logic lives in services/.
 *
 * Webhook POST payload structure (Meta sends this):
 *   {
 *     object: "whatsapp_business_account",
 *     entry: [{
 *       changes: [{
 *         value: {
 *           messages: [{ id, from, type, text: { body } }],
 *           statuses: [{ id, status, ... }]   ← delivery receipts, ignored
 *         }
 *       }]
 *     }]
 *   }
 *
 * Flow for an incoming text message:
 *   1. Extract message + sender phone from payload
 *   2. Mark message as read (double-tick)
 *   3. Parse the command intent
 *   4. Dispatch to the correct handler
 *   5. Send WhatsApp reply
 *   6. Return HTTP 200 to Meta immediately (Meta retries on non-200)
 *
 * IMPORTANT: Always return HTTP 200 to Meta even if processing fails.
 * Meta will retry delivery up to ~20 times over 24 hours on any non-200.
 * Business logic errors are handled by sending the user an error message,
 * NOT by returning a non-200 status to Meta.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import config from '../config/env.js';
import { parseMessage, INTENTS, getCommandHint, buildHelpMenu } from '../utils/messageParser.js';
import { parseDate, parseTimeRange, buildDateTimeRange } from '../utils/dateParser.js';
import { getAvailableSlots, createBooking, cancelBooking, getBookingsByPhone } from '../services/calendarService.js';
import {
  markAsRead,
  sendTypingIndicator,
  sendAvailabilityReply,
  sendBookingConfirmation,
  sendCancellationConfirmation,
  sendBookingsList,
  sendHelpMenu,
  sendErrorMessage,
} from '../services/whatsappService.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Webhook Verification (GET)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * verifyWebhook()
 * ───────────────────────────────────────────────────────────────────────────
 * Handles the one-time webhook verification challenge from Meta.
 *
 * When you register a webhook URL in the Meta Developer Portal, Meta sends
 * a GET request with three query parameters:
 *   hub.mode         → "subscribe"
 *   hub.verify_token → the token YOU set in the portal (must match .env)
 *   hub.challenge    → a random string Meta wants echoed back
 *
 * If we respond with hub.challenge, Meta marks the webhook as verified.
 *
 * @route  GET /api/v1/webhook
 */
const verifyWebhook = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[webhookController] 🔐 Webhook verification request received');

  // Validate mode and token
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[webhookController] ✅ Webhook verified successfully');
    // Respond with the challenge to complete verification
    return res.status(200).send(challenge);
  }

  // Token mismatch — reject
  console.warn('[webhookController] ❌ Webhook verification failed — token mismatch');
  return res.status(403).json({ error: 'Verification failed: token mismatch' });
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Incoming Message Handler (POST)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * handleIncoming()
 * ───────────────────────────────────────────────────────────────────────────
 * Handles all incoming POST events from the WhatsApp Cloud API webhook.
 *
 * Meta sends many event types (messages, statuses, reactions, etc.).
 * We only process type === "text" messages — all others are acknowledged
 * with 200 and silently ignored.
 *
 * @route  POST /api/v1/webhook
 */
const handleIncoming = async (req, res) => {
  // ── Always respond 200 to Meta immediately ────────────────────────────────
  // Processing happens async after the response is sent.
  // This prevents Meta from retrying and sending duplicate messages.
  res.status(200).json({ status: 'ok' });

  try {
    const body = req.body;

    // Validate this is a WhatsApp Business Account event
    if (body?.object !== 'whatsapp_business_account') {
      console.warn('[webhookController] ⚠️  Received non-WhatsApp webhook event — ignoring');
      return;
    }

    // ── Extract message from the nested Meta payload structure ───────────────
    const entry   = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    // Handle status updates (delivery receipts) — acknowledge and ignore
    if (value?.statuses?.length > 0) {
      const status = value.statuses[0];
      console.log(`[webhookController] 📬 Status update: ${status.status} for message ${status.id}`);
      return;
    }

    // Extract message — if none, nothing to do
    const message = value?.messages?.[0];
    if (!message) {
      console.log('[webhookController] ℹ️  No message in payload — ignoring');
      return;
    }

    // ── Only process text messages ────────────────────────────────────────────
    if (message.type !== 'text') {
      console.log(`[webhookController] ⏭️  Non-text message type "${message.type}" — ignoring`);
      // Optionally, send a reply telling the user to send text commands
      await sendErrorMessage(
        message.from,
        `I can only understand text messages.\nPlease type a command like:\n*availability today*`
      );
      return;
    }

    // ── Extract sender info and message text ──────────────────────────────────
    const senderPhone = message.from;              // E.164 format, e.g. "919876543210"
    const messageId   = message.id;
    const messageText = message.text?.body ?? '';

    // Extract sender display name if available (from contacts metadata)
    const contact      = value?.contacts?.[0];
    const senderName   = contact?.profile?.name ?? 'Customer';

    console.log(`[webhookController] 📨 Message from ${senderPhone} (${senderName}): "${messageText}"`);

    // ── Mark as read + acknowledge immediately ────────────────────────────────
    await sendTypingIndicator(messageId);

    // ── Parse the command intent ──────────────────────────────────────────────
    const parsed = parseMessage(messageText);
    console.log(`[webhookController] 🔍 Intent: ${parsed.intent} | Args:`, parsed.args);

    // ── Dispatch to the correct handler ──────────────────────────────────────
    await dispatchIntent(parsed, senderPhone, senderName);

  } catch (err) {
    // This catch is a last-resort safety net.
    // Individual handlers have their own try/catch and send user-facing errors.
    console.error('[webhookController] 💥 Unhandled error in handleIncoming:', err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Intent dispatcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * dispatchIntent()
 * ───────────────────────────────────────────────────────────────────────────
 * Routes a parsed command to the appropriate handler function.
 * Each handler is responsible for calling the right services and
 * sending the WhatsApp reply.
 *
 * @param {ParsedCommand} parsed      - Output from parseMessage()
 * @param {string}        senderPhone - Sender's WhatsApp number (E.164)
 * @param {string}        senderName  - Sender's display name
 */
const dispatchIntent = async (parsed, senderPhone, senderName) => {
  switch (parsed.intent) {

    case INTENTS.AVAILABILITY:
      return handleAvailability(parsed.args, senderPhone);

    case INTENTS.BOOK:
      return handleBook(parsed.args, senderPhone, senderName);

    case INTENTS.CANCEL:
      return handleCancel(parsed.args, senderPhone);

    case INTENTS.MY_BOOKINGS:
      return handleMyBookings(senderPhone);

    case INTENTS.HELP:
      return handleHelp(senderPhone);

    case INTENTS.UNKNOWN:
    default:
      return handleUnknown(parsed.args, senderPhone);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Individual intent handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * handleAvailability()
 * ───────────────────────────────────────────────────────────────────────────
 * Processes: "availability today" / "availability 10-Jul-2026"
 *
 * Flow:
 *   1. Parse the date string from args
 *   2. Query Google Calendar via FreeBusy
 *   3. Send availability reply
 */
const handleAvailability = async ({ dateStr }, senderPhone) => {
  // Parse the date
  const parsedDate = parseDate(dateStr);
  if (!parsedDate.isValid) {
    return sendErrorMessage(senderPhone, parsedDate.error);
  }

  // Fetch availability from Google Calendar
  const availability = await getAvailableSlots(parsedDate.date);
  if (!availability.success) {
    return sendErrorMessage(senderPhone, availability.error);
  }

  return sendAvailabilityReply(senderPhone, availability, parsedDate.date);
};

/**
 * handleBook()
 * ───────────────────────────────────────────────────────────────────────────
 * Processes: "book 10-Jul-2026 8am-11am"
 *
 * Flow:
 *   1. Parse date and time range from args
 *   2. Build full datetime range + validate (past, working hours, min duration)
 *   3. Create Google Calendar event
 *   4. Send confirmation with booking reference
 */
const handleBook = async ({ dateStr, timeRange }, senderPhone, senderName) => {
  // ── Parse date ────────────────────────────────────────────────────────────
  const parsedDate = parseDate(dateStr);
  if (!parsedDate.isValid) {
    return sendErrorMessage(senderPhone, parsedDate.error);
  }

  // ── Parse time range ──────────────────────────────────────────────────────
  const parsedTime = parseTimeRange(timeRange);
  if (!parsedTime.isValid) {
    return sendErrorMessage(senderPhone, parsedTime.error);
  }

  // ── Build and validate the full datetime range ────────────────────────────
  const dateTimeRange = buildDateTimeRange(parsedDate.date, parsedTime);
  if (!dateTimeRange.isValid) {
    return sendErrorMessage(senderPhone, dateTimeRange.error);
  }

  // ── Create the booking in Google Calendar ─────────────────────────────────
  const result = await createBooking({
    startISO:      dateTimeRange.startISO,
    endISO:        dateTimeRange.endISO,
    customerPhone: senderPhone,
    customerName:  senderName,
  });

  if (!result.success) {
    return sendErrorMessage(senderPhone, result.error);
  }

  return sendBookingConfirmation(senderPhone, result.booking);
};

/**
 * handleCancel()
 * ───────────────────────────────────────────────────────────────────────────
 * Processes: "cancel BK-3f2504e0"
 *
 * Flow:
 *   1. Extract booking reference from args
 *   2. Cancel booking via calendar service (includes ownership + time checks)
 *   3. Send cancellation confirmation
 */
const handleCancel = async ({ bookingRef }, senderPhone) => {
  const result = await cancelBooking({
    bookingRef,
    customerPhone: senderPhone,
  });

  if (!result.success) {
    return sendErrorMessage(senderPhone, result.error);
  }

  return sendCancellationConfirmation(senderPhone, result.booking);
};

/**
 * handleMyBookings()
 * ───────────────────────────────────────────────────────────────────────────
 * Processes: "my bookings"
 *
 * Flow:
 *   1. Fetch all upcoming bookings for the sender's phone number
 *   2. Send formatted bookings list
 */
const handleMyBookings = async (senderPhone) => {
  const result = await getBookingsByPhone(senderPhone);

  if (!result.success) {
    return sendErrorMessage(senderPhone, result.error);
  }

  return sendBookingsList(senderPhone, result.bookings);
};

/**
 * handleHelp()
 * ───────────────────────────────────────────────────────────────────────────
 * Processes: "help" / "hi" / "hello" / "menu"
 *
 * Sends the full command menu.
 */
const handleHelp = async (senderPhone) => {
  const helpText = await buildHelpMenu();
  return sendHelpMenu(senderPhone, helpText);
};

/**
 * handleUnknown()
 * ───────────────────────────────────────────────────────────────────────────
 * Handles unrecognised commands.
 *
 * If the message looks like an incomplete command (e.g. "book" with no date),
 * send a targeted hint. Otherwise send the full help menu.
 */
const handleUnknown = async ({ partialIntent }, senderPhone) => {
  const hint = getCommandHint(partialIntent);

  if (hint) {
    // Targeted correction for partial commands
    return sendErrorMessage(senderPhone, hint);
  }

  // Completely unrecognised — show the full help menu
  const helpText = await buildHelpMenu();
  return sendHelpMenu(senderPhone, helpText);
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { verifyWebhook, handleIncoming };