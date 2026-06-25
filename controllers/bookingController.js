import { z } from 'zod';
import {
  getAvailableSlots,
  createBooking,
  cancelBooking,
  getBookingByRef,
  getBookingsByPhone,
  getAllBookings,
} from '../services/calendarService.js';
import { parseDate } from '../utils/dateParser.js';
import dayjs from 'dayjs';

const bookingRefSchema = z
  .string()
  .regex(/^BK-[0-9a-f]{8}$/i, 'Invalid booking reference format. Expected: BK-xxxxxxxx');

const listQuerySchema = z.object({
  phone:       z.string().min(7).optional(),
  includePast: z.string().optional().transform((v) => v === 'true'),
});

const availabilityBodySchema = z.object({
  date: z.string().min(1, 'date is required'),
});

const createBookingBodySchema = z.object({
  startISO:      z.string().datetime({ message: 'startISO must be a valid ISO 8601 datetime' }),
  endISO:        z.string().datetime({ message: 'endISO must be a valid ISO 8601 datetime' }),
  customerPhone: z
    .string()
    .min(7, 'customerPhone is required')
    .regex(/^\+?[\d\s\-()@.]+$/, 'customerPhone must contain only valid characters'),
  customerName: z.string().min(1).max(100).optional().default('Admin Booking'),
});

const adminCancelSchema = z.object({
  customerPhone: z.string().min(7).optional(),
});

const ok   = (res, data, status = 200) => res.status(status).json({ success: true,  data });
const fail = (res, error, status = 400) => res.status(status).json({ success: false, error });
const formatZodErrors = (zodError) =>
  zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

const listAllBookings = async (req, res) => {
  const includePast = req.query.includePast === 'true';
  const timeMin = includePast
    ? dayjs().subtract(30, 'day').toISOString()
    : dayjs().subtract(7, 'day').toISOString();
  const timeMax = dayjs().add(90, 'day').toISOString();

  const result = await getAllBookings(timeMin, timeMax);
  if (!result.success) return fail(res, result.error, 502);
  return ok(res, { count: result.bookings.length, bookings: result.bookings });
};

const listBookings = async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, formatZodErrors(parsed.error));

  const { phone, includePast } = parsed.data;

  if (phone) {
    const result = await getBookingsByPhone(phone, includePast);
    if (!result.success) return fail(res, result.error, 502);
    return ok(res, { phone, includePast, count: result.bookings.length, bookings: result.bookings });
  }

  const timeMin = includePast
    ? dayjs().subtract(30, 'day').toISOString()
    : dayjs().subtract(7, 'day').toISOString();
  const timeMax = dayjs().add(90, 'day').toISOString();

  const result = await getAllBookings(timeMin, timeMax);
  if (!result.success) return fail(res, result.error, 502);
  return ok(res, { count: result.bookings.length, bookings: result.bookings });
};

const getBooking = async (req, res) => {
  const parsed = bookingRefSchema.safeParse(req.params.ref);
  if (!parsed.success) return fail(res, parsed.error.issues[0].message);

  const bookingRef = parsed.data.toUpperCase();
  const { booking, error } = await getBookingByRef(bookingRef);

  if (error)    return fail(res, error, 502);
  if (!booking) return fail(res, `No booking found with reference ${bookingRef}`, 404);
  return ok(res, { booking });
};

const deleteBooking = async (req, res) => {
  const refParsed = bookingRefSchema.safeParse(req.params.ref);
  if (!refParsed.success) return fail(res, refParsed.error.issues[0].message);

  const bookingRef = refParsed.data.toUpperCase();

  const bodyParsed = adminCancelSchema.safeParse(req.body);
  if (!bodyParsed.success) return fail(res, formatZodErrors(bodyParsed.error));

  const { booking: existingBooking, error: findError } = await getBookingByRef(bookingRef);
  if (findError)        return fail(res, findError, 502);
  if (!existingBooking) return fail(res, `No booking found with reference ${bookingRef}`, 404);

  const result = await cancelBooking({
    bookingRef,
    customerPhone: existingBooking.customerPhone,
  });

  if (!result.success) return fail(res, result.error);
  return ok(res, { message: `Booking ${bookingRef} has been cancelled`, booking: result.booking });
};

const checkAvailability = async (req, res) => {
  const bodyParsed = availabilityBodySchema.safeParse(req.body);
  if (!bodyParsed.success) return fail(res, formatZodErrors(bodyParsed.error));

  const parsedDate = parseDate(bodyParsed.data.date);
  if (!parsedDate.isValid) return fail(res, parsedDate.error);

  const availability = await getAvailableSlots(parsedDate.date);
  if (!availability.success) return fail(res, availability.error, 502);

  return ok(res, {
    date:        parsedDate.dateStr,
    dateDisplay: availability.dateDisplay,
    hasSlots:    availability.hasSlots,
    slotCount:   availability.slots.length,
    slots:       availability.slots,
  });
};

const createBookingAdmin = async (req, res) => {
  const bodyParsed = createBookingBodySchema.safeParse(req.body);
  if (!bodyParsed.success) return fail(res, formatZodErrors(bodyParsed.error));

  const { startISO, endISO, customerPhone, customerName } = bodyParsed.data;

  if (new Date(endISO) <= new Date(startISO)) return fail(res, 'endISO must be after startISO');
  if (new Date(startISO) <= new Date())        return fail(res, 'startISO must be in the future');

  const result = await createBooking({ startISO, endISO, customerPhone, customerName });
  if (!result.success) return fail(res, result.error);
  return ok(res, { booking: result.booking }, 201);
};

export {
  listAllBookings,
  listBookings,
  getBooking,
  deleteBooking,
  checkAvailability,
  createBookingAdmin,
};