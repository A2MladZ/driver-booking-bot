/**
 * services/calendarService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core Google Calendar service.
 *
 * Responsibilities:
 *   - Query FreeBusy API to find when the driver is occupied
 *   - Calculate available time slots by diffing busy periods against
 *     the driver's working hours window
 *   - Create Google Calendar events when a booking is confirmed
 *   - Delete Google Calendar events when a booking is cancelled
 *   - List all events tagged with a customer's phone number
 *   - Fetch a single event by booking reference ID
 *
 * All times are handled in the driver's configured timezone (DRIVER_TIMEZONE).
 * ISO 8601 strings passed to/from Google Calendar are always UTC — dayjs
 * with the timezone plugin handles the conversion transparently.
 *
 * Booking metadata stored in the Google Calendar event:
 *   event.summary        → "Booking BK-xxxxxxxx — <customer name>"
 *   event.description    → JSON blob with bookingRef, customerPhone, customerName
 *   event.extendedProperties.private.bookingRef    → for fast lookups
 *   event.extendedProperties.private.customerPhone → for "my bookings" queries
 * ─────────────────────────────────────────────────────────────────────────────
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import { v4 as uuidv4 } from 'uuid';

import { calendar, calendarId } from '../config/googleCalendar.js';
import config from '../config/env.js';
import { formatSlot, formatDate, nowInTz } from '../utils/dateParser.js';

// ── Extend dayjs ──────────────────────────────────────────────────────────────
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);

const TZ = config.driver.timezone;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a booking reference ID.
 * Format: BK-xxxxxxxx  (BK- prefix + first 8 chars of a UUID v4)
 * Example: BK-3f2504e0
 *
 * The prefix makes references easy to spot in WhatsApp messages.
 * The 8-char UUID segment gives 16^8 = ~4 billion combinations —
 * more than sufficient for a single-driver booking system.
 *
 * @returns {string}
 */
const generateBookingRef = () => `BK-${uuidv4().split('-')[0]}`;

/**
 * Parses a Google Calendar event's extended properties to extract
 * the booking metadata blob we stored when creating the event.
 *
 * @param {object} event - Raw Google Calendar event object
 * @returns {{ bookingRef: string, customerPhone: string, customerName: string }|null}
 */
const extractBookingMeta = (event) => {
  try {
    const props = event?.extendedProperties?.private ?? {};
    if (!props.bookingRef) return null;
    return {
      bookingRef:    props.bookingRef,
      customerPhone: props.customerPhone ?? 'unknown',
      customerName:  props.customerName  ?? 'Customer',
    };
  } catch {
    return null;
  }
};

/**
 * Converts a raw Google Calendar event into a clean Booking object
 * suitable for display and API responses.
 *
 * @param {object} event - Raw Google Calendar event
 * @returns {Booking|null}
 *
 * @typedef  {object} Booking
 * @property {string} bookingRef
 * @property {string} customerPhone
 * @property {string} customerName
 * @property {string} startISO
 * @property {string} endISO
 * @property {string} displaySlot   - Human-readable "Thu, 10 Jul 2026 • 8:00 AM – 11:00 AM"
 * @property {string} calEventId    - Google Calendar event ID (for deletion)
 * @property {string} status        - "confirmed"
 */
const eventToBooking = (event) => {
  const meta = extractBookingMeta(event);
  if (!meta) return null;

  const startISO = event.start?.dateTime ?? event.start?.date;
  const endISO   = event.end?.dateTime   ?? event.end?.date;
  if (!startISO || !endISO) return null;

  return {
    bookingRef:    meta.bookingRef,
    customerPhone: meta.customerPhone,
    customerName:  meta.customerName,
    startISO,
    endISO,
    displaySlot:   formatSlot(startISO, endISO),
    calEventId:    event.id,
    status:        'confirmed',
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Availability — FreeBusy query + slot calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getAvailableSlots()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns a list of available time slots for a given date by:
 *   1. Querying the Google FreeBusy API for the driver's busy periods
 *   2. Subtracting busy periods from the working hours window
 *   3. Filtering out gaps shorter than DRIVER_MIN_SLOT_MINUTES
 *
 * @param {dayjs.Dayjs} date - The date to check (dayjs object, driver timezone)
 * @returns {Promise<AvailabilityResult>}
 *
 * @typedef  {object} AvailabilityResult
 * @property {boolean}      success
 * @property {string}       dateDisplay    - e.g. "Thu, 10 Jul 2026"
 * @property {SlotWindow[]} slots          - Available slots
 * @property {boolean}      hasSlots
 * @property {string}       [error]
 *
 * @typedef  {object} SlotWindow
 * @property {string} startISO
 * @property {string} endISO
 * @property {string} display              - "8:00 AM – 11:00 AM"
 * @property {number} durationMinutes
 */
const getAvailableSlots = async (date) => {
  // ── Build the working-hours window for this date ──────────────────────────
  const [workStartH, workStartM] = config.driver.workStart.split(':').map(Number);
  const [workEndH,   workEndM]   = config.driver.workEnd.split(':').map(Number);

  const windowStart = date.clone().hour(workStartH).minute(workStartM).second(0).millisecond(0);
  const windowEnd   = date.clone().hour(workEndH).minute(workEndM).second(0).millisecond(0);

  // If the window end has already passed today, return no slots immediately
  const now = nowInTz();
  if (windowEnd.isSameOrBefore(now)) {
    return {
      success:     true,
      dateDisplay: formatDate(date),
      slots:       [],
      hasSlots:    false,
    };
  }

  // ── Query the FreeBusy API ────────────────────────────────────────────────
  let busyPeriods = [];
  try {
    const freeBusyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        timeZone: TZ,
        items: [{ id: calendarId }],
      },
    });

    // Extract busy periods for our calendar
    const calBusy = freeBusyResponse.data?.calendars?.[calendarId]?.busy ?? [];

    // Sort by start time (Google usually returns them sorted, but be safe)
    busyPeriods = calBusy
      .map((b) => ({
        start: dayjs(b.start).tz(TZ),
        end:   dayjs(b.end).tz(TZ),
      }))
      .sort((a, b) => a.start.valueOf() - b.start.valueOf());

  } catch (err) {
    console.error('[calendarService] FreeBusy query failed:', err.message);
    return {
      success: false,
      error:   'Could not fetch availability from Google Calendar. Please try again.',
    };
  }

  // ── Calculate free slots by diffing busy periods from the window ──────────
  const freeSlots = [];
  let cursor = windowStart;

  // Also advance cursor past "now" so we don't show slots that have started
  if (now.isAfter(cursor)) {
    // Round up to the next 30-minute boundary for cleaner display
    const minsOver = now.minute() % 30;
    cursor = minsOver === 0
      ? now.clone()
      : now.clone().add(30 - minsOver, 'minute').startOf('minute');
  }

  for (const busy of busyPeriods) {
    // Gap between cursor and start of this busy period
    if (busy.start.isAfter(cursor)) {
      const gapEnd      = busy.start;
      const gapMinutes  = gapEnd.diff(cursor, 'minute');

      if (gapMinutes >= config.driver.minSlotMinutes) {
        freeSlots.push({
          startISO:        cursor.toISOString(),
          endISO:          gapEnd.toISOString(),
          display:         `${cursor.format('h:mm A')} – ${gapEnd.format('h:mm A')}`,
          durationMinutes: gapMinutes,
        });
      }
    }
    // Advance cursor past this busy period (never go backwards)
    if (busy.end.isAfter(cursor)) {
      cursor = busy.end;
    }
  }

  // Trailing gap from last busy period (or start of day) to end of window
  if (windowEnd.isAfter(cursor)) {
    const gapMinutes = windowEnd.diff(cursor, 'minute');
    if (gapMinutes >= config.driver.minSlotMinutes) {
      freeSlots.push({
        startISO:        cursor.toISOString(),
        endISO:          windowEnd.toISOString(),
        display:         `${cursor.format('h:mm A')} – ${windowEnd.format('h:mm A')}`,
        durationMinutes: gapMinutes,
      });
    }
  }

  return {
    success:     true,
    dateDisplay: formatDate(date),
    slots:       freeSlots,
    hasSlots:    freeSlots.length > 0,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Check if a specific time slot is still available
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isSlotAvailable()
 * ───────────────────────────────────────────────────────────────────────────
 * Checks whether a specific [startISO, endISO] window has no conflicting
 * events in the driver's calendar.
 *
 * Uses the FreeBusy API (lighter than listing all events) for an exact check.
 *
 * @param {string} startISO - ISO 8601 start datetime
 * @param {string} endISO   - ISO 8601 end datetime
 * @returns {Promise<{ available: boolean, error?: string }>}
 */
const isSlotAvailable = async (startISO, endISO) => {
  try {
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin:  startISO,
        timeMax:  endISO,
        timeZone: TZ,
        items:    [{ id: calendarId }],
      },
    });

    const busy = response.data?.calendars?.[calendarId]?.busy ?? [];
    return { available: busy.length === 0 };

  } catch (err) {
    console.error('[calendarService] isSlotAvailable check failed:', err.message);
    return { available: false, error: 'Could not verify slot availability.' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Create a booking (Google Calendar event)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createBooking()
 * ───────────────────────────────────────────────────────────────────────────
 * Creates a Google Calendar event for a confirmed booking and returns
 * a Booking object with the generated booking reference.
 *
 * Metadata strategy:
 *   - event.summary → human-readable title visible in Google Calendar
 *   - event.description → JSON for easy reading in the calendar UI
 *   - extendedProperties.private → indexed metadata for programmatic lookups
 *     (private properties are not exposed to other apps sharing the calendar)
 *
 * @param {object} params
 * @param {string} params.startISO      - ISO 8601 start datetime
 * @param {string} params.endISO        - ISO 8601 end datetime
 * @param {string} params.customerPhone - WhatsApp phone number (E.164)
 * @param {string} [params.customerName] - Optional display name
 * @returns {Promise<{ success: boolean, booking?: Booking, error?: string }>}
 */
const createBooking = async ({ startISO, endISO, customerPhone, customerName = 'Customer' }) => {
  // ── Pre-flight availability check ─────────────────────────────────────────
  const { available, error: availError } = await isSlotAvailable(startISO, endISO);
  if (availError) return { success: false, error: availError };
  if (!available) {
    return {
      success: false,
      error:
        `⚠️ That slot was just taken by another booking.\n` +
        `Please check *availability* again and choose a different time.`,
    };
  }

  // ── Generate booking reference ────────────────────────────────────────────
  const bookingRef = generateBookingRef();

  // ── Build the Google Calendar event payload ───────────────────────────────
  const eventPayload = {
    summary: `🚗 Booking ${bookingRef} — ${customerName}`,
    description: JSON.stringify(
      {
        bookingRef,
        customerPhone,
        customerName,
        bookedAt: new Date().toISOString(),
        source:   'WhatsApp Bot',
      },
      null,
      2
    ),
    start: {
      dateTime: startISO,
      timeZone: TZ,
    },
    end: {
      dateTime: endISO,
      timeZone: TZ,
    },
    // Extended properties allow us to query events by bookingRef or phone
    extendedProperties: {
      private: {
        bookingRef,
        customerPhone,
        customerName,
      },
    },
    // Reminder: 1 hour before and 10 minutes before
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
    // Colour: Blueberry (dark blue) — makes bookings visually distinct
    colorId: '9',
  };

  // ── Create the event ──────────────────────────────────────────────────────
  try {
    const response = await calendar.events.insert({
      calendarId,
      requestBody: eventPayload,
    });

    const createdEvent = response.data;
    const booking      = eventToBooking(createdEvent);

    if (!booking) {
      // This shouldn't happen but guard against it
      return {
        success: false,
        error:   'Booking was created but could not be read back. Check Google Calendar.',
      };
    }

    console.log(`[calendarService] ✅ Booking created: ${bookingRef} for ${customerPhone}`);
    return { success: true, booking };

  } catch (err) {
    console.error('[calendarService] Event creation failed:', err.message);

    // Surface quota/permission errors clearly
    const status = err?.response?.status;
    if (status === 403) {
      return { success: false, error: 'Calendar permission error. Please contact support.' };
    }
    if (status === 409) {
      return { success: false, error: 'Booking conflict detected. Please choose another slot.' };
    }

    return { success: false, error: 'Failed to create booking. Please try again.' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cancel a booking (delete the Google Calendar event)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * cancelBooking()
 * ───────────────────────────────────────────────────────────────────────────
 * Finds and deletes the Google Calendar event associated with a booking
 * reference. Also verifies that the requester's phone matches the booking
 * to prevent strangers from cancelling other people's bookings.
 *
 * @param {object} params
 * @param {string} params.bookingRef    - e.g. "BK-3f2504e0"
 * @param {string} params.customerPhone - WhatsApp phone of the requester
 * @returns {Promise<{ success: boolean, booking?: Booking, error?: string }>}
 */
const cancelBooking = async ({ bookingRef, customerPhone }) => {
  // ── Find the event by bookingRef ──────────────────────────────────────────
  const { booking, error: findError } = await getBookingByRef(bookingRef);
  if (findError) return { success: false, error: findError };
  if (!booking)  return { success: false, error: `No booking found with reference *${bookingRef}*.` };

  // ── Ownership check ───────────────────────────────────────────────────────
  // Normalise phone numbers before comparing (strip leading + or spaces)
  const normalise = (p) => p.replace(/\D/g, '');
  if (normalise(booking.customerPhone) !== normalise(customerPhone)) {
    return {
      success: false,
      error:   `❌ You can only cancel your own bookings.\n*${bookingRef}* belongs to a different customer.`,
    };
  }

  // ── Check the booking hasn't already started ──────────────────────────────
  const now       = nowInTz();
  const slotStart = dayjs(booking.startISO).tz(TZ);
  if (slotStart.isSameOrBefore(now)) {
    return {
      success: false,
      error:   `⚠️ You cannot cancel *${bookingRef}* because it has already started or passed.`,
    };
  }

  // ── Delete the calendar event ─────────────────────────────────────────────
  try {
    await calendar.events.delete({
      calendarId,
      eventId: booking.calEventId,
    });

    console.log(`[calendarService] 🗑️  Booking cancelled: ${bookingRef} by ${customerPhone}`);
    return { success: true, booking };

  } catch (err) {
    const status = err?.response?.status;
    if (status === 410) {
      // 410 Gone — event was already deleted (idempotent, treat as success)
      return { success: true, booking };
    }
    console.error('[calendarService] Event deletion failed:', err.message);
    return { success: false, error: 'Failed to cancel booking. Please try again.' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Get a single booking by reference ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getBookingByRef()
 * ───────────────────────────────────────────────────────────────────────────
 * Searches the calendar for an event with a matching bookingRef in its
 * extendedProperties.private fields.
 *
 * Google Calendar does not support querying by private extended properties
 * directly, so we use a text search on the summary (which contains the ref)
 * and then confirm via extendedProperties.
 *
 * @param {string} bookingRef - e.g. "BK-3f2504e0"
 * @returns {Promise<{ booking?: Booking, error?: string }>}
 */
const getBookingByRef = async (bookingRef) => {
  try {
    const response = await calendar.events.list({
      calendarId,
      q:             bookingRef,   // Full-text search — matches summary
      singleEvents:  true,
      maxResults:    5,            // Should only be 1, but buffer for safety
      showDeleted:   false,
    });

    const events = response.data?.items ?? [];

    // Confirm via extendedProperties (summary search can have false positives)
    const match = events.find(
      (e) => e.extendedProperties?.private?.bookingRef === bookingRef
    );

    if (!match) return { booking: null };

    const booking = eventToBooking(match);
    return { booking };

  } catch (err) {
    console.error('[calendarService] getBookingByRef failed:', err.message);
    return { error: 'Could not retrieve booking details. Please try again.' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. List all bookings for a customer phone number
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getBookingsByPhone()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns all upcoming (and optionally past) bookings associated with a
 * customer's WhatsApp phone number.
 *
 * Because Google Calendar doesn't support querying by private extended
 * properties, we fetch all future events from the calendar and filter
 * client-side. For a single-driver calendar this is efficient enough —
 * a driver rarely has more than a few dozen future events.
 *
 * @param {string}  customerPhone - WhatsApp phone (E.164)
 * @param {boolean} [includePast] - Include past bookings (default: false)
 * @returns {Promise<{ success: boolean, bookings?: Booking[], error?: string }>}
 */
const getBookingsByPhone = async (customerPhone, includePast = false) => {
  try {
    const timeMin = includePast
      ? dayjs().tz(TZ).subtract(30, 'day').toISOString()  // Last 30 days
      : nowInTz().toISOString();                            // From now

    const response = await calendar.events.list({
      calendarId,
      timeMin,
      singleEvents:  true,
      orderBy:       'startTime',
      maxResults:    100,
      showDeleted:   false,
    });

    const events = response.data?.items ?? [];

    // Filter by customerPhone in extendedProperties
    const normalise    = (p) => p.replace(/\D/g, '');
    const normPhone    = normalise(customerPhone);

    const bookings = events
      .filter((e) => {
        const phone = e.extendedProperties?.private?.customerPhone ?? '';
        return normalise(phone) === normPhone;
      })
      .map(eventToBooking)
      .filter(Boolean);                // Remove any nulls from eventToBooking

    return { success: true, bookings };

  } catch (err) {
    console.error('[calendarService] getBookingsByPhone failed:', err.message);
    return { success: false, error: 'Could not retrieve your bookings. Please try again.' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  getAvailableSlots,
  isSlotAvailable,
  createBooking,
  cancelBooking,
  getBookingByRef,
  getBookingsByPhone,
};