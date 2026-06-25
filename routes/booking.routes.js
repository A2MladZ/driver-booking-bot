/**
 * routes/booking.routes.js
 * Mounted at: /api/v1/bookings
 */

import { Router } from 'express';
import {
  listBookings,
  listAllBookings,
  getBooking,
  deleteBooking,
  checkAvailability,
  createBookingAdmin,
} from '../controllers/bookingController.js';

const router = Router();

router.post('/availability', checkAvailability);
router.get('/all',           listAllBookings);   // ← must be before /:ref
router.get('/',              listBookings);
router.post('/',             createBookingAdmin);
router.get('/:ref',          getBooking);
router.delete('/:ref',       deleteBooking);

export default router;