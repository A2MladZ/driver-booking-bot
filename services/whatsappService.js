/**
 * services/whatsappService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * WhatsApp Cloud API outbound messaging service.
 *
 * Responsibilities:
 *   - Send text messages via the WhatsApp Cloud API
 *   - Mark incoming messages as "read" (double-tick)
 *   - Provide purpose-built reply formatters for every bot response type:
 *       • Availability results
 *       • Booking confirmation
 *       • Cancellation confirmation
 *       • Customer's booking list
 *       • Help menu
 *       • Error messages
 *
 * All outbound calls go through the single `sendMessage()` primitive.
 * Higher-level methods build the message text and call sendMessage().
 *
 * WhatsApp text formatting (renders natively in WhatsApp):
 *   *bold*         _italic_        ~strikethrough~
 *   ```monospace```
 *
 * API reference:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios from 'axios';
import config from '../config/env.js';

// ─────────────────────────────────────────────────────────────────────────────
// Axios instance — pre-configured for the WhatsApp Cloud API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A dedicated axios instance so we never have to repeat the base URL,
 * auth header, or content-type across call sites.
 */
const whatsappAxios = axios.create({
  baseURL: `${config.whatsapp.apiBaseUrl}/${config.whatsapp.phoneNumberId}/messages`,
  headers: {
    Authorization: `Bearer ${config.whatsapp.accessToken}`,
    'Content-Type': 'application/json',
  },
  timeout: 10_000, // 10 second timeout — WhatsApp API is usually <500ms
});

// ─────────────────────────────────────────────────────────────────────────────
// Core primitive — sendMessage()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sendMessage()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends a plain text message to a WhatsApp recipient.
 *
 * Uses the "text" message type with preview_url disabled (cleaner for
 * bot messages that don't need link previews).
 *
 * @param {string} to   - Recipient phone number in E.164 format (e.g. "919876543210")
 * @param {string} text - Message body (supports WhatsApp markdown)
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
const sendMessage = async (to, text) => {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body:        text,
      },
    };

    const response = await whatsappAxios.post('', payload);
    const messageId = response.data?.messages?.[0]?.id;

    console.log(`[whatsappService] ✅ Message sent to ${to} | ID: ${messageId}`);
    return { success: true, messageId };

  } catch (err) {
    // Extract the WhatsApp API error detail if available
    const apiError = err?.response?.data?.error;
    const errMsg   = apiError
      ? `[${apiError.code}] ${apiError.message}`
      : err.message;

    console.error(`[whatsappService] ❌ Failed to send message to ${to}: ${errMsg}`);

    return {
      success: false,
      error:   errMsg,
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Mark messages as read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * markAsRead()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends a "read" receipt for an incoming message so the user sees
 * the double blue tick immediately — signals that the bot received
 * their message and is processing it.
 *
 * This is a best-effort call — failure is logged but never thrown,
 * as it should never block sending the actual reply.
 *
 * @param {string} messageId - The incoming message ID from the webhook payload
 * @returns {Promise<void>}
 */
const markAsRead = async (messageId) => {
  try {
    await whatsappAxios.post('', {
      messaging_product: 'whatsapp',
      status:            'read',
      message_id:        messageId,
    });
  } catch (err) {
    // Non-critical — log and continue
    console.warn(`[whatsappService] ⚠️  Could not mark message ${messageId} as read:`, err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatted reply builders
// Each method composes a WhatsApp-formatted string and calls sendMessage()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sendAvailabilityReply()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends the availability check result for a given date.
 *
 * When slots exist:
 *   📅 *Availability for Thu, 10 Jul 2026*
 *
 *   ✅ Available slots:
 *   1. 8:00 AM – 11:00 AM (3 hrs)
 *   2. 1:00 PM – 6:00 PM  (5 hrs)
 *
 *   To book, reply:
 *   *book 10-Jul-2026 8am-11am*
 *
 * When no slots:
 *   📅 *Availability for Thu, 10 Jul 2026*
 *
 *   ❌ No available slots on this date.
 *
 * @param {string}       to            - Recipient phone (E.164)
 * @param {object}       availability  - Result from calendarService.getAvailableSlots()
 * @param {dayjs.Dayjs}  date          - The queried date (for booking command hint)
 * @returns {Promise<{ success: boolean }>}
 */
const sendAvailabilityReply = async (to, availability, date) => {
  const { dateDisplay, slots, hasSlots } = availability;

  let text = `📅 *Availability for ${dateDisplay}*\n\n`;

  if (!hasSlots) {
    text += `❌ No available slots on this date.\n\n`;
    text += `The driver is fully booked or working hours have passed.\n`;
    text += `Try: *availability tomorrow*`;
  } else {
    text += `✅ *Available slots:*\n`;

    slots.forEach((slot, index) => {
      const hrs  = Math.floor(slot.durationMinutes / 60);
      const mins = slot.durationMinutes % 60;
      const dur  = hrs > 0
        ? `${hrs}h${mins > 0 ? ` ${mins}m` : ''}`
        : `${mins}m`;

      text += `\n${index + 1}. ${slot.display} _(${dur})_`;
    });

    // Provide a ready-to-use booking command example using the first slot
    const firstSlot    = slots[0];
    const exampleStart = firstSlot.display.split('–')[0].trim();
    const exampleEnd   = firstSlot.display.split('–')[1].trim();

    // Format for the book command: convert "8:00 AM" → "8am", "11:00 AM" → "11am"
    const toCommandTime = (t) => {
      const [time, period] = t.split(' ');
      const [h, m]         = time.split(':');
      const mins           = m === '00' ? '' : `:${m}`;
      return `${parseInt(h, 10)}${mins}${period.toLowerCase()}`;
    };

    const cmdDate  = date.format('D-MMM-YYYY');
    const cmdStart = toCommandTime(exampleStart);
    const cmdEnd   = toCommandTime(exampleEnd);

    text += `\n\n📋 *To book, reply:*\n`;
    text += `*book ${cmdDate} ${cmdStart}-${cmdEnd}*`;
  }

  return sendMessage(to, text);
};

/**
 * sendBookingConfirmation()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends a booking confirmation message with all booking details.
 *
 * Example:
 *   ✅ *Booking Confirmed!*
 *
 *   📋 Reference: *BK-3f2504e0*
 *   📅 Date & Time: Thu, 10 Jul 2026 • 8:00 AM – 11:00 AM
 *
 *   To cancel this booking, reply:
 *   *cancel BK-3f2504e0*
 *
 * @param {string} to      - Recipient phone (E.164)
 * @param {object} booking - Booking object from calendarService.createBooking()
 * @returns {Promise<{ success: boolean }>}
 */
const sendBookingConfirmation = async (to, booking) => {
  const text =
    `✅ *Booking Confirmed!*\n\n` +
    `📋 Reference:  *${booking.bookingRef}*\n` +
    `📅 Date & Time: ${booking.displaySlot}\n\n` +
    `_Keep your reference ID safe — you'll need it to cancel._\n\n` +
    `To cancel, reply:\n` +
    `*cancel ${booking.bookingRef}*`;

  return sendMessage(to, text);
};

/**
 * sendCancellationConfirmation()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends a cancellation confirmation message.
 *
 * Example:
 *   🗑️ *Booking Cancelled*
 *
 *   Reference: BK-3f2504e0
 *   Slot: Thu, 10 Jul 2026 • 8:00 AM – 11:00 AM
 *
 *   This slot is now available for others to book.
 *
 * @param {string} to      - Recipient phone (E.164)
 * @param {object} booking - The cancelled booking object
 * @returns {Promise<{ success: boolean }>}
 */
const sendCancellationConfirmation = async (to, booking) => {
  const text =
    `🗑️ *Booking Cancelled*\n\n` +
    `Reference: *${booking.bookingRef}*\n` +
    `Slot: ${booking.displaySlot}\n\n` +
    `This slot is now available for others to book.\n\n` +
    `To make a new booking:\n` +
    `*availability today*`;

  return sendMessage(to, text);
};

/**
 * sendBookingsList()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends the customer's upcoming bookings as a formatted list.
 *
 * When bookings exist:
 *   📂 *Your Upcoming Bookings* (2)
 *
 *   1. *BK-3f2504e0*
 *      Thu, 10 Jul 2026 • 8:00 AM – 11:00 AM
 *      cancel BK-3f2504e0
 *
 *   2. *BK-7a1b2c3d*
 *      Fri, 11 Jul 2026 • 2:00 PM – 5:00 PM
 *      cancel BK-7a1b2c3d
 *
 * When no bookings:
 *   📂 *Your Upcoming Bookings*
 *
 *   You have no upcoming bookings.
 *   Try: *availability today*
 *
 * @param {string}    to       - Recipient phone (E.164)
 * @param {Booking[]} bookings - Array of Booking objects
 * @returns {Promise<{ success: boolean }>}
 */
const sendBookingsList = async (to, bookings) => {
  if (!bookings || bookings.length === 0) {
    const text =
      `📂 *Your Upcoming Bookings*\n\n` +
      `You have no upcoming bookings.\n\n` +
      `To check availability:\n` +
      `*availability today*`;

    return sendMessage(to, text);
  }

  let text = `📂 *Your Upcoming Bookings* (${bookings.length})\n`;

  bookings.forEach((booking, index) => {
    text += `\n${index + 1}. *${booking.bookingRef}*\n`;
    text += `   📅 ${booking.displaySlot}\n`;
    text += `   ❌ cancel ${booking.bookingRef}\n`;
  });

  text += `\nReply with a *cancel* command to cancel any booking.`;

  return sendMessage(to, text);
};

/**
 * sendHelpMenu()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends the full help/command menu.
 *
 * @param {string} to       - Recipient phone (E.164)
 * @param {string} helpText - Pre-built help menu string from buildHelpMenu()
 * @returns {Promise<{ success: boolean }>}
 */
const sendHelpMenu = async (to, helpText) => {
  return sendMessage(to, helpText);
};

/**
 * sendErrorMessage()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends a user-facing error message.
 * Wraps the error text with a standard prefix and a help nudge.
 *
 * @param {string} to    - Recipient phone (E.164)
 * @param {string} error - The error message (already WhatsApp-formatted)
 * @returns {Promise<{ success: boolean }>}
 */
const sendErrorMessage = async (to, error) => {
  const text = `${error}\n\nType *help* to see all available commands.`;
  return sendMessage(to, text);
};

/**
 * sendTypingIndicator()
 * ───────────────────────────────────────────────────────────────────────────
 * Sends a "typing..." indicator to show the bot is processing.
 *
 * Note: The WhatsApp Cloud API does not currently support a native typing
 * indicator via the messages endpoint the way the on-premise API does.
 * This is a placeholder that marks the message as read immediately, which
 * achieves a similar "acknowledged" UX effect.
 *
 * When Meta adds typing indicator support to the Cloud API, update this
 * method to use: { type: 'typing', ... }
 *
 * @param {string} messageId - The incoming message ID to acknowledge
 * @returns {Promise<void>}
 */
const sendTypingIndicator = async (messageId) => {
  // Currently implemented as a read receipt — update when Cloud API supports typing
  await markAsRead(messageId);
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  sendMessage,
  markAsRead,
  sendTypingIndicator,
  sendAvailabilityReply,
  sendBookingConfirmation,
  sendCancellationConfirmation,
  sendBookingsList,
  sendHelpMenu,
  sendErrorMessage,
};