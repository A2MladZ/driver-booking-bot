/**
 * services/googleChatService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Chat outbound messaging service.
 * Replaces whatsappService.js — same API shape, different transport.
 *
 * Google Chat formatting:
 *   Plain text only in simple messages.
 *   Cards v2 for rich formatting (not used here — keeps parity with old bot).
 *   *bold* and `code` do NOT render in Google Chat plain text.
 *   Use ALL CAPS or line breaks for emphasis instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chat } from '../config/googleChat.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Core primitive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sendMessage()
 * Sends a plain text message to a Google Chat space.
 *
 * @param {string} spaceName - Google Chat space resource name e.g. "spaces/AAAA"
 * @param {string} text      - Message body
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
const sendMessage = async (spaceName, text) => {
  try {
    const response = await chat.spaces.messages.create({
      parent:      spaceName,
      requestBody: { text },
    });

    const messageId = response.data?.name;
    logger.info(`Message sent to ${spaceName}`, 'whatsapp', { messageId });
    return { success: true, messageId };

  } catch (err) {
    logger.error('Failed to send Google Chat message', 'whatsapp', { spaceName }, err);
    return { success: false, error: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatted reply builders
// ─────────────────────────────────────────────────────────────────────────────

const sendAvailabilityReply = async (spaceName, availability, date) => {
  const { dateDisplay, slots, hasSlots } = availability;
  let text = `📅 Availability for ${dateDisplay}\n\n`;

  if (!hasSlots) {
    text += `❌ No available slots on this date.\n`;
    text += `Try: availability tomorrow`;
  } else {
    text += `✅ Available slots:\n`;
    slots.forEach((slot, i) => {
      const hrs  = Math.floor(slot.durationMinutes / 60);
      const mins = slot.durationMinutes % 60;
      const dur  = hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
      text += `\n${i + 1}. ${slot.display} (${dur})`;
    });

    const first    = slots[0];
    const cmdDate  = date.format('D-MMM-YYYY');
    const [s, e]   = first.display.split('–').map(t => t.trim());
    const toCmd    = (t) => {
      const [time, period] = t.split(' ');
      const [h, m]         = time.split(':');
      return `${parseInt(h)}${m !== '00' ? `:${m}` : ''}${period.toLowerCase()}`;
    };

    text += `\n\nTo book, reply:\nbook ${cmdDate} ${toCmd(s)}-${toCmd(e)}`;
  }

  return sendMessage(spaceName, text);
};

const sendBookingConfirmation = async (spaceName, booking) => {
  const text =
    `✅ Booking Confirmed!\n\n` +
    `Reference:  ${booking.bookingRef}\n` +
    `Date & Time: ${booking.displaySlot}\n\n` +
    `To cancel, reply:\ncancel ${booking.bookingRef}`;

  return sendMessage(spaceName, text);
};

const sendCancellationConfirmation = async (spaceName, booking) => {
  const text =
    `🗑️ Booking Cancelled\n\n` +
    `Reference: ${booking.bookingRef}\n` +
    `Slot: ${booking.displaySlot}\n\n` +
    `To make a new booking:\navailability today`;

  return sendMessage(spaceName, text);
};

const sendBookingsList = async (spaceName, bookings) => {
  if (!bookings || bookings.length === 0) {
    return sendMessage(
      spaceName,
      `📂 Your Upcoming Bookings\n\nYou have no upcoming bookings.\n\nTry: availability today`
    );
  }

  let text = `📂 Your Upcoming Bookings (${bookings.length})\n`;
  bookings.forEach((b, i) => {
    text += `\n${i + 1}. ${b.bookingRef}\n   📅 ${b.displaySlot}\n   cancel ${b.bookingRef}\n`;
  });

  return sendMessage(spaceName, text);
};

const sendHelpMenu = async (spaceName, helpText) => {
  return sendMessage(spaceName, helpText);
};

const sendErrorMessage = async (spaceName, error) => {
  return sendMessage(spaceName, `${error}\n\nType "help" to see all commands.`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  sendMessage,
  sendAvailabilityReply,
  sendBookingConfirmation,
  sendCancellationConfirmation,
  sendBookingsList,
  sendHelpMenu,
  sendErrorMessage,
};
