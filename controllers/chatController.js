/**
 * controllers/chatController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Chat event controller. Replaces webhookController.js.
 *
 * Google Chat sends these event types:
 *   MESSAGE        → user sent a message to the bot
 *   ADDED_TO_SPACE → bot was added to a space or DM
 *   REMOVED_FROM_SPACE → bot was removed
 *   CARD_CLICKED   → user clicked a card button (not used)
 *
 * Verification:
 *   Google Chat signs requests with a Bearer token issued to the
 *   bot's service account. We verify the token's audience matches
 *   our project number. No separate verify_token needed.
 *
 * Response:
 *   Unlike WhatsApp, Google Chat accepts a JSON reply body directly
 *   in the HTTP response — no separate API call needed for simple replies.
 *   We use this for instant responses and fall back to chat.spaces.messages
 *   for async operations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { OAuth2Client } from 'google-auth-library';
import config from '../config/env.js';
import { parseMessage, INTENTS, getCommandHint, buildHelpMenu } from '../utils/messageParser.js';
import { parseDate, parseTimeRange, buildDateTimeRange } from '../utils/dateParser.js';
import { getAvailableSlots, createBooking, cancelBooking, getBookingsByPhone } from '../services/calendarService.js';
import logger from '../utils/logger.js';

// ── Token verifier ────────────────────────────────────────────────────────────
const authClient = new OAuth2Client();

/**
 * verifyGoogleToken()
 * Verifies the Bearer token Google Chat sends with every request.
 * Audience must match our Google Cloud project number.
 *
 * @param {string} token - Raw Bearer token from Authorization header
 * @returns {Promise<boolean>}
 */
const verifyGoogleToken = async (token) => {
  try {
    const audience = config.googleChat.projectNumber;
    await authClient.verifyIdToken({ idToken: token, audience });
    return true;
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * handleChatEvent()
 * Receives all Google Chat events on POST /api/v1/chat
 *
 * @route POST /api/v1/chat
 */
const handleChatEvent = async (req, res) => {
  // ── Verify token ──────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? '';
  const token      = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    logger.warn('Google Chat request missing auth token', 'webhook');
    return res.status(401).json({ text: 'Unauthorized' });
  }

  const valid = await verifyGoogleToken(token);
  if (!valid) {
    logger.warn('Google Chat token verification failed', 'webhook');
    return res.status(401).json({ text: 'Unauthorized' });
  }

  try {
    const event     = req.body;
    const eventType = event?.type;
    const spaceName = event?.space?.name;       // e.g. "spaces/AAAA"
    const senderEmail = event?.user?.email ?? 'unknown';
    const senderName  = event?.user?.displayName ?? 'User';

    logger.info(`Google Chat event: ${eventType}`, 'webhook', { spaceName, senderEmail });

    // ── Handle event types ────────────────────────────────────────────────
    if (eventType === 'ADDED_TO_SPACE') {
      const helpText = await buildHelpMenu();
      return res.status(200).json({ text: `👋 Hi! I'm the Driver Booking Bot.\n\n${helpText}` });
    }

    if (eventType === 'REMOVED_FROM_SPACE') {
      logger.info('Bot removed from space', 'webhook', { spaceName });
      return res.status(200).json({});
    }

    if (eventType !== 'MESSAGE') {
      return res.status(200).json({});
    }

    // ── Extract message text ──────────────────────────────────────────────
    const messageText = event?.message?.text ?? '';

    logger.webhook(senderEmail, messageText, 'pending');

    // ── Parse and dispatch ────────────────────────────────────────────────
    const parsed = parseMessage(messageText.trim());
    logger.info(`Intent: ${parsed.intent}`, 'webhook', { args: parsed.args });

    const replyText = await dispatchIntent(parsed, senderEmail, senderName);
    return res.status(200).json({ text: replyText ?? '✅ Done.' });

  } catch (err) {
    logger.error('Unhandled error in handleChatEvent', 'webhook', {}, err);
    return res.status(200).json({ text: '❌ Something went wrong. Please try again.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Intent dispatcher
// ─────────────────────────────────────────────────────────────────────────────

const dispatchIntent = async (parsed, senderEmail, senderName) => {
  switch (parsed.intent) {
    case INTENTS.AVAILABILITY:
      return handleAvailability(parsed.args);
    case INTENTS.BOOK:
      return handleBook(parsed.args, senderEmail, senderName);
    case INTENTS.CANCEL:
      return handleCancel(parsed.args, senderEmail);
    case INTENTS.MY_BOOKINGS:
      return handleMyBookings(senderEmail);
    case INTENTS.HELP:
      return handleHelp();
    default:
      return handleUnknown(parsed.args);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Intent handlers
// ─────────────────────────────────────────────────────────────────────────────

const handleAvailability = async ({ dateStr }) => {
  const parsedDate = parseDate(dateStr);
  if (!parsedDate.isValid) return `❌ ${parsedDate.error}`;

  const availability = await getAvailableSlots(parsedDate.date);
  if (!availability.success) return `❌ ${availability.error}`;

  // Format available slots as text
  const { slots, date } = availability;
  if (!slots || slots.length === 0) return `📅 No available slots on ${date}.`;
  const lines = slots.map(s => `• ${s.start} – ${s.end}`).join('\n');
  return `📅 Available slots on ${date}:\n${lines}`;
};

const handleBook = async ({ dateStr, timeRange }, senderEmail, senderName) => {
  const parsedDate = parseDate(dateStr);
  if (!parsedDate.isValid) return `❌ ${parsedDate.error}`;

  const parsedTime = parseTimeRange(timeRange);
  if (!parsedTime.isValid) return `❌ ${parsedTime.error}`;

  const dateTimeRange = buildDateTimeRange(parsedDate.date, parsedTime);
  if (!dateTimeRange.isValid) return `❌ ${dateTimeRange.error}`;

  const result = await createBooking({
    startISO:      dateTimeRange.startISO,
    endISO:        dateTimeRange.endISO,
    customerPhone: senderEmail,
    customerName:  senderName,
  });

  if (!result.success) return `❌ ${result.error}`;
  const b = result.booking;
  return `✅ Booking confirmed!\nRef: *${b.bookingRef}*\nDate: ${b.date}\nTime: ${b.startTime} – ${b.endTime}`;
};

const handleCancel = async ({ bookingRef }, senderEmail) => {
  const result = await cancelBooking({
    bookingRef,
    customerPhone: senderEmail,
  });

  if (!result.success) return `❌ ${result.error}`;
  return `✅ Booking *${result.booking.bookingRef}* has been cancelled.`;
};

const handleMyBookings = async (senderEmail) => {
  const result = await getBookingsByPhone(senderEmail);
  if (!result.success) return `❌ ${result.error}`;
  if (!result.bookings || result.bookings.length === 0) return `📋 You have no upcoming bookings.`;
  const lines = result.bookings.map(b => `• *${b.bookingRef}* — ${b.date} ${b.startTime}–${b.endTime}`).join('\n');
  return `📋 Your bookings:\n${lines}`;
};

const handleHelp = async () => {
  const helpText = await buildHelpMenu();
  return helpText;
};

const handleUnknown = async ({ partialIntent }) => {
  const hint = getCommandHint(partialIntent);
  if (hint) return `❓ ${hint}`;
  const helpText = await buildHelpMenu();
  return helpText;
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { handleChatEvent };
