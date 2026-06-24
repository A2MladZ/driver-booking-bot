/**
 * routes/booking.routes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express router for admin booking management REST endpoints.
 *
 * Mounted at: /api/v1/bookings  (see server.js)
 *
 * Routes:
 *   GET    /api/v1/bookings                    → List bookings by phone
 *   GET    /api/v1/bookings/:ref               → Get single booking by reference
 *   DELETE /api/v1/bookings/:ref               → Cancel a booking
 *   POST   /api/v1/bookings/availability       → Check availability for a date
 *   POST   /api/v1/bookings                    → Create a booking (admin)
 *
 * Route ordering note:
 *   /availability must be registered BEFORE /:ref so Express does not
 *   interpret the literal string "availability" as a :ref parameter value.
 * ─────────────────────────────────────────────────────────────────────────────
 */
console.log("✅ booking.routes.js LOADED");
import { Router } from 'express';
import {
  listBookings,
  getBooking,
  deleteBooking,
  checkAvailability,
  createBookingAdmin,
} from '../controllers/bookingController.js';

const router = Router();

/**
 * POST /api/v1/bookings/availability
 *
 * Check driver availability for a given date.
 * Must be registered before /:ref to avoid route shadowing.
 *
 * Body: { "date": "10-Jul-2026" }
 */
router.post('/availability', checkAvailability);

/**
 * GET /api/v1/bookings?phone=919876543210
 *
 * List all upcoming bookings for a customer phone number.
 * Optional: &includePast=true to include past bookings.
 */
router.get('/', listBookings);

/**
 * POST /api/v1/bookings
 *
 * Create a booking directly (admin use — bypasses WhatsApp flow).
 * Body: { startISO, endISO, customerPhone, customerName }
 */
router.post('/', createBookingAdmin);

/**
 * GET /api/v1/bookings/:ref
 *
 * Fetch a single booking by its BK-xxxxxxxx reference.
 */
router.get('/:ref', getBooking);

/**
 * DELETE /api/v1/bookings/:ref
 *
 * Cancel a booking by its BK-xxxxxxxx reference.
 * Admin bypass — no phone ownership restriction.
 */
router.delete('/:ref', deleteBooking);

export default router;