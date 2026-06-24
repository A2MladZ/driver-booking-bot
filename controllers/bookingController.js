/**
 * controllers/bookingController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * REST API controller for admin booking management.
 *
 * Responsibilities:
 *   - Expose calendar booking data over HTTP endpoints
 *   - Allow programmatic booking lookups, listings, and cancellations
 *   - Validate incoming request parameters with Zod
 *   - Return consistent JSON responses for all outcomes
 *
 * These endpoints are NOT called by WhatsApp — they are for:
 *   • An admin dashboard to view/manage all bookings
 *   • Debugging during development
 *   • Integration with other internal systems
 *
 * Architecture rule:
 *   Controllers handle HTTP only. All calendar logic stays in calendarService.
 *
 * Routes (mounted at /api/v1/bookings in server.js):
 *   GET    /                      → List bookings (filter by phone or date)
 *   GET    /:ref                  → Get single booking by reference
 *   DELETE /:ref                  → Cancel a booking by reference
 *   POST   /availability          → Check availability for a date (REST version)
 *
 * Response envelope:
 *   Success: { success: true,  data: <payload> }
 *   Failure: { success: false, error: <message> }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';
import {
  getAvailableSlots,
  createBooking,
  cancelBooking,
  getBookingByRef,
  getBookingsByPhone,
} from '../services/calendarService.js';
import { parseDate } from '../utils/dateParser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zod validation schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Booking reference format: BK- followed by exactly 8 hex characters.
 * Used to validate :ref route parameters.
 */
const bookingRefSchema = z
  .string()
  .regex(/^BK-[0-9a-f]{8}$/i, 'Invalid booking reference format. Expected: BK-xxxxxxxx');

/**
 * Query parameters for GET /bookings
 */
const listQuerySchema = z.object({
  phone:       z.string().min(7).optional(),
  includePast: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

/**
 * Body for POST /bookings/availability
 */
const availabilityBodySchema = z.object({
  date: z.string().min(1, 'date is required'),
});

/**
 * Body for POST /bookings (direct booking via REST — admin use)
 */
const createBookingBodySchema = z.object({
  startISO:      z.string().datetime({ message: 'startISO must be a valid ISO 8601 datetime' }),
  endISO:        z.string().datetime({ message: 'endISO must be a valid ISO 8601 datetime' }),
  customerPhone: z
    .string()
    .min(7, 'customerPhone is required')
    .regex(/^\+?[\d\s\-()]+$/, 'customerPhone must contain only digits, +, spaces, or hyphens'),
  customerName: z.string().min(1).max(100).optional().default('Admin Booking'),
});

/**
 * Body for DELETE /bookings/:ref (admin cancel — no phone ownership check)
 */
const adminCancelSchema = z.object({
  customerPhone: z
    .string()
    .min(7, 'customerPhone is required to identify the booking owner')
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper — consistent JSON response builders
// ─────────────────────────────────────────────────────────────────────────────

const ok    = (res, data, status = 200) => res.status(status).json({ success: true,  data });
const fail  = (res, error, status = 400) => res.status(status).json({ success: false, error });

/**
 * Formats Zod validation errors into a readable string array.
 * @param {z.ZodError} zodError
 * @returns {string[]}
 */
const formatZodErrors = (zodError) =>
  zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/v1/bookings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * listBookings()
 * ───────────────────────────────────────────────────────────────────────────
 * Lists bookings. Requires a ?phone= query parameter to scope results to a
 * specific customer (prevents accidentally exposing all customers' bookings
 * without auth).
 *
 * Query params:
 *   phone        (required) — customer phone number
 *   includePast  (optional) — "true" to include past bookings (default: false)
 *
 * @example
 *   GET /api/v1/bookings?phone=919876543210
 *   GET /api/v1/bookings?phone=919876543210&includePast=true
 */
console.log("🔥 listBookings HIT");
export const listBookings = async (req, res) => {
  return res.json({
    success: true,
    message: "CONTROLLER WORKS 🚀",
    query: req.query
  });
};
  const { phone, includePast } = parsed.data;

  if (!phone) {
    return fail(res, 'Query parameter "phone" is required. Example: ?phone=919876543210');
  }

  // ── Fetch bookings ────────────────────────────────────────────────────────
  const result = await getBookingsByPhone(phone, includePast);
  if (!result.success) {
    return fail(res, result.error, 502);
  }

  return ok(res, {
    phone,
    includePast,
    count:    result.bookings.length,
    bookings: result.bookings,
  });
;

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /api/v1/bookings/:ref
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getBooking()
 * ───────────────────────────────────────────────────────────────────────────
 * Fetches a single booking by its reference ID.
 *
 * @example
 *   GET /api/v1/bookings/BK-3f2504e0
 */
const getBooking = async (req, res) => {
  // ── Validate :ref parameter ───────────────────────────────────────────────
  const parsed = bookingRefSchema.safeParse(req.params.ref);
  if (!parsed.success) {
    return fail(res, parsed.error.issues[0].message);
  }

  const bookingRef = parsed.data.toUpperCase();

  // ── Fetch from calendar ───────────────────────────────────────────────────
  const { booking, error } = await getBookingByRef(bookingRef);

  if (error) return fail(res, error, 502);
  if (!booking) {
    return fail(res, `No booking found with reference ${bookingRef}`, 404);
  }

  return ok(res, { booking });
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. DELETE /api/v1/bookings/:ref
// ─────────────────────────────────────────────────────────────────────────────

/**
 * deleteBooking()
 * ───────────────────────────────────────────────────────────────────────────
 * Cancels a booking by reference. For admin use — bypasses the phone
 * ownership check that the WhatsApp flow enforces by accepting the phone
 * number in the request body.
 *
 * @example
 *   DELETE /api/v1/bookings/BK-3f2504e0
 *   Body: { "customerPhone": "919876543210" }
 */
const deleteBooking = async (req, res) => {
  // ── Validate :ref parameter ───────────────────────────────────────────────
  const refParsed = bookingRefSchema.safeParse(req.params.ref);
  if (!refParsed.success) {
    return fail(res, refParsed.error.issues[0].message);
  }

  const bookingRef = refParsed.data.toUpperCase();

  // ── Validate body ─────────────────────────────────────────────────────────
  const bodyParsed = adminCancelSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return fail(res, formatZodErrors(bodyParsed.error));
  }

  // ── Look up the booking first to get the owner's phone ───────────────────
  const { booking: existingBooking, error: findError } = await getBookingByRef(bookingRef);
  if (findError) return fail(res, findError, 502);
  if (!existingBooking) {
    return fail(res, `No booking found with reference ${bookingRef}`, 404);
  }

  // ── Cancel — use the booking's stored phone so ownership check passes ─────
  const result = await cancelBooking({
    bookingRef,
    customerPhone: existingBooking.customerPhone,   // Admin bypass
  });

  if (!result.success) {
    return fail(res, result.error);
  }

  return ok(res, {
    message: `Booking ${bookingRef} has been cancelled`,
    booking: result.booking,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /api/v1/bookings/availability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkAvailability()
 * ───────────────────────────────────────────────────────────────────────────
 * REST endpoint to check driver availability for a given date.
 * Accepts the same date formats as the WhatsApp bot.
 *
 * @example
 *   POST /api/v1/bookings/availability
 *   Body: { "date": "10-Jul-2026" }
 *   Body: { "date": "today" }
 */
const checkAvailability = async (req, res) => {
  // ── Validate body ─────────────────────────────────────────────────────────
  const bodyParsed = availabilityBodySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return fail(res, formatZodErrors(bodyParsed.error));
  }

  const { date: dateStr } = bodyParsed.data;

  // ── Parse the date string ─────────────────────────────────────────────────
  const parsedDate = parseDate(dateStr);
  if (!parsedDate.isValid) {
    return fail(res, parsedDate.error);
  }

  // ── Fetch availability ────────────────────────────────────────────────────
  const availability = await getAvailableSlots(parsedDate.date);
  if (!availability.success) {
    return fail(res, availability.error, 502);
  }

  return ok(res, {
    date:        parsedDate.dateStr,
    dateDisplay: availability.dateDisplay,
    hasSlots:    availability.hasSlots,
    slotCount:   availability.slots.length,
    slots:       availability.slots,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. POST /api/v1/bookings  (Admin direct booking)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createBookingAdmin()
 * ───────────────────────────────────────────────────────────────────────────
 * Creates a booking directly via REST (admin use, bypasses WhatsApp flow).
 * Accepts raw ISO 8601 datetimes for precision.
 *
 * @example
 *   POST /api/v1/bookings
 *   Body: {
 *     "startISO":      "2026-07-10T08:00:00.000Z",
 *     "endISO":        "2026-07-10T11:00:00.000Z",
 *     "customerPhone": "919876543210",
 *     "customerName":  "John Doe"
 *   }
 */
const createBookingAdmin = async (req, res) => {
  // ── Validate body ─────────────────────────────────────────────────────────
  const bodyParsed = createBookingBodySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    return fail(res, formatZodErrors(bodyParsed.error));
  }

  const { startISO, endISO, customerPhone, customerName } = bodyParsed.data;

  // ── Basic datetime sanity check ───────────────────────────────────────────
  if (new Date(endISO) <= new Date(startISO)) {
    return fail(res, 'endISO must be after startISO');
  }

  if (new Date(startISO) <= new Date()) {
    return fail(res, 'startISO must be in the future');
  }

  // ── Create the booking ────────────────────────────────────────────────────
  const result = await createBooking({ startISO, endISO, customerPhone, customerName });

  if (!result.success) {
    return fail(res, result.error);
  }

  return ok(res, { booking: result.booking }, 201);
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  listBookings,
  getBooking,
  deleteBooking,
  checkAvailability,
  createBookingAdmin,
};