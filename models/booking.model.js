/**
 * models/booking.model.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Booking data model — schema definition, type documentation, factory
 * functions, and validation helpers.
 *
 * This project uses Google Calendar as its data store (no separate database),
 * so this is NOT an ORM model. Instead it provides:
 *
 *   1. A Zod schema that defines the exact shape of a Booking object
 *   2. A factory function to construct Booking objects from raw data
 *   3. Formatting helpers used across controllers and services
 *   4. Status constants for the booking lifecycle
 *
 * The Booking shape:
 *   {
 *     bookingRef:    "BK-3f2504e0"           ← unique reference ID
 *     customerPhone: "919876543210"           ← E.164 WhatsApp number
 *     customerName:  "John Doe"              ← display name
 *     startISO:      "2026-07-10T02:30:00Z"  ← UTC ISO 8601
 *     endISO:        "2026-07-10T05:30:00Z"  ← UTC ISO 8601
 *     displaySlot:   "Thu, 10 Jul 2026 • 8:00 AM – 11:00 AM"
 *     calEventId:    "abc123xyz"             ← Google Calendar event ID
 *     status:        "confirmed"             ← booking lifecycle status
 *     bookedAt:      "2026-07-01T10:00:00Z"  ← when the booking was made
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { formatSlot } from '../utils/dateParser.js';
import config from '../config/env.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Status constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Booking lifecycle statuses.
 * Currently only "confirmed" is used (cancelled bookings are deleted from
 * Google Calendar immediately). Extend this if you add soft-delete later.
 */
export const BOOKING_STATUS = Object.freeze({
  CONFIRMED:  'confirmed',
  CANCELLED:  'cancelled',   // Reserved for future soft-delete support
  COMPLETED:  'completed',   // Reserved for past-booking tracking
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Zod schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zod schema for a Booking object.
 * Used to validate data coming out of Google Calendar before returning
 * it to controllers or WhatsApp replies.
 */
export const bookingSchema = z.object({
  bookingRef: z
    .string()
    .regex(/^BK-[0-9a-f]{8}$/i, 'Invalid booking reference format'),

  customerPhone: z
    .string()
    .min(7, 'customerPhone is required'),

  customerName: z
    .string()
    .min(1)
    .max(100)
    .default('Customer'),

  startISO: z
    .string()
    .datetime({ message: 'startISO must be a valid ISO 8601 datetime' }),

  endISO: z
    .string()
    .datetime({ message: 'endISO must be a valid ISO 8601 datetime' }),

  displaySlot: z
    .string()
    .min(1),

  calEventId: z
    .string()
    .min(1, 'Google Calendar event ID is required'),

  status: z
    .enum([
      BOOKING_STATUS.CONFIRMED,
      BOOKING_STATUS.CANCELLED,
      BOOKING_STATUS.COMPLETED,
    ])
    .default(BOOKING_STATUS.CONFIRMED),

  bookedAt: z
    .string()
    .datetime()
    .optional(),
});

/** TypeDef for IDE autocompletion
 * @typedef {z.infer<typeof bookingSchema>} Booking
 */

// ─────────────────────────────────────────────────────────────────────────────
// 3. Factory function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createBookingObject()
 * ───────────────────────────────────────────────────────────────────────────
 * Constructs and validates a Booking object from raw field values.
 * Throws a ZodError if the data is invalid.
 *
 * Used by calendarService.eventToBooking() to transform raw Google Calendar
 * event data into a validated Booking.
 *
 * @param {object} raw - Raw booking fields
 * @returns {Booking}  - Validated booking object
 */
export const createBookingObject = (raw) => {
  const data = {
    bookingRef:    raw.bookingRef,
    customerPhone: raw.customerPhone,
    customerName:  raw.customerName  ?? 'Customer',
    startISO:      raw.startISO,
    endISO:        raw.endISO,
    displaySlot:   raw.displaySlot  ?? formatSlot(raw.startISO, raw.endISO),
    calEventId:    raw.calEventId,
    status:        raw.status       ?? BOOKING_STATUS.CONFIRMED,
    bookedAt:      raw.bookedAt     ?? new Date().toISOString(),
  };

  return bookingSchema.parse(data);
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Derived property helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isUpcoming()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns true if the booking's start time is in the future.
 *
 * @param {Booking} booking
 * @returns {boolean}
 */
export const isUpcoming = (booking) =>
  dayjs(booking.startISO).isAfter(dayjs());

/**
 * isPast()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns true if the booking's end time has already passed.
 *
 * @param {Booking} booking
 * @returns {boolean}
 */
export const isPast = (booking) =>
  dayjs(booking.endISO).isBefore(dayjs());

/**
 * isActive()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns true if the booking is currently in progress.
 *
 * @param {Booking} booking
 * @returns {boolean}
 */
export const isActive = (booking) => {
  const now   = dayjs();
  const start = dayjs(booking.startISO);
  const end   = dayjs(booking.endISO);
  return now.isAfter(start) && now.isBefore(end);
};

/**
 * getDurationMinutes()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns the duration of the booking in minutes.
 *
 * @param {Booking} booking
 * @returns {number}
 */
export const getDurationMinutes = (booking) =>
  dayjs(booking.endISO).diff(dayjs(booking.startISO), 'minute');

/**
 * toSummaryString()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns a one-line summary of a booking for logging/debugging.
 *
 * @param {Booking} booking
 * @returns {string}
 */
export const toSummaryString = (booking) => {
  const duration = getDurationMinutes(booking);
  const tz       = config.driver.timezone;
  const start    = dayjs(booking.startISO).tz(tz).format('D-MMM-YYYY HH:mm');
  return `[${booking.bookingRef}] ${booking.customerName} (${booking.customerPhone}) @ ${start} for ${duration}min`;
};

/**
 * toWhatsAppSummary()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns a WhatsApp-formatted single-line booking summary.
 * Used in list views where space is limited.
 *
 * @param {Booking} booking
 * @param {number}  index   - 1-based display index
 * @returns {string}
 */
export const toWhatsAppSummary = (booking, index) =>
  `${index}. *${booking.bookingRef}*\n` +
  `   📅 ${booking.displaySlot}\n` +
  `   ❌ cancel ${booking.bookingRef}`;