/**
 * utils/dateParser.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Natural language date and time range parser.
 *
 * Responsibilities:
 *   - Parse user-supplied date strings into Day.js objects
 *     e.g. "today", "tomorrow", "10-Jul-2026", "2026-07-10"
 *
 *   - Parse user-supplied time range strings into { start, end } objects
 *     e.g. "8am-11am", "08:00-11:00", "2pm-5:30pm"
 *
 *   - Combine a parsed date + time range into full ISO datetime strings
 *     ready for the Google Calendar API
 *
 *   - Validate that ranges are logical (start < end, within working hours,
 *     not in the past)
 *
 * All output datetimes are produced in the driver's configured timezone
 * (DRIVER_TIMEZONE) so Google Calendar stores them correctly.
 *
 * Dependencies: chrono-node, dayjs, dayjs/plugin/timezone, dayjs/plugin/utc
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as chrono from 'chrono-node';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import config from '../config/env.js';

// ── Extend dayjs with required plugins ────────────────────────────────────────
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);

// ── Constants ─────────────────────────────────────────────────────────────────
const TZ = config.driver.timezone;  // e.g. "Asia/Kolkata"

/**
 * Supported explicit date formats (tried in order before chrono fallback).
 * Covers the formats documented in the bot's command reference.
 */
const EXPLICIT_DATE_FORMATS = [
  'D-MMM-YYYY',   // 10-Jul-2026
  'DD-MMM-YYYY',  // 10-Jul-2026 (zero-padded)
  'D-MMM-YY',     // 10-Jul-26
  'YYYY-MM-DD',   // 2026-07-10  (ISO)
  'DD/MM/YYYY',   // 10/07/2026
  'D/M/YYYY',     // 10/7/2026
  'MMM D, YYYY',  // Jul 10, 2026
  'MMMM D, YYYY', // July 10, 2026
];

/**
 * Regex patterns to extract time ranges from strings like:
 *   "8am-11am"   "08:00-11:00"   "2pm-5:30pm"   "14:00-17:30"
 *
 * Capture groups: [fullMatch, startHour, startMin?, startPeriod?, endHour, endMin?, endPeriod?]
 */
const TIME_RANGE_REGEX =
  /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts hour + optional minute + optional am/pm into a 24-hour integer hour.
 *
 * @param {number} hour       - Raw hour value (1–12 or 0–23)
 * @param {string} [period]   - "am" | "pm" | undefined
 * @returns {number}          - 24-hour hour (0–23)
 */
const to24Hour = (hour, period) => {
  const h = parseInt(hour, 10);
  if (!period) return h;                          // Already 24-hour format
  const p = period.toLowerCase();
  if (p === 'am') return h === 12 ? 0 : h;       // 12am → 00:00
  if (p === 'pm') return h === 12 ? 12 : h + 12; // 12pm → 12:00, 1pm → 13:00
  return h;
};

/**
 * Returns a dayjs instance set to the start of a given date in the driver's
 * timezone (time components zeroed out).
 *
 * @param {string} dateStr - e.g. "2026-07-10"
 * @returns {dayjs.Dayjs}
 */
const startOfDayInTz = (dateStr) =>
  dayjs.tz(dateStr, TZ).startOf('day');

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseDate()
 * ───────────────────────────────────────────────────────────────────────────
 * Parses a user-supplied date string into a dayjs object (timezone-aware).
 *
 * Supported inputs:
 *   "today"         → today's date in driver timezone
 *   "tomorrow"      → tomorrow's date in driver timezone
 *   "10-Jul-2026"   → explicit date (multiple formats supported)
 *   "2026-07-10"    → ISO date
 *   "next monday"   → chrono-node natural language fallback
 *
 * @param   {string} input - Raw user date string
 * @returns {{ date: dayjs.Dayjs, dateStr: string, isValid: boolean, error?: string }}
 */
const parseDate = (input) => {
  if (!input || typeof input !== 'string') {
    return { isValid: false, error: 'No date input provided.' };
  }

  const trimmed = input.trim().toLowerCase();

  // ── 1. Handle "today" and "tomorrow" explicitly ──────────────────────────
  if (trimmed === 'today') {
    const date = dayjs().tz(TZ).startOf('day');
    return {
      date,
      dateStr: date.format('D-MMM-YYYY'),
      isValid: true,
    };
  }

  if (trimmed === 'tomorrow') {
    const date = dayjs().tz(TZ).add(1, 'day').startOf('day');
    return {
      date,
      dateStr: date.format('D-MMM-YYYY'),
      isValid: true,
    };
  }

  // ── 2. Try explicit format list first (faster & more predictable) ─────────
  for (const fmt of EXPLICIT_DATE_FORMATS) {
    const parsed = dayjs.tz(input.trim(), fmt, TZ);
    if (parsed.isValid()) {
      const date = parsed.startOf('day');
      return {
        date,
        dateStr: date.format('D-MMM-YYYY'),
        isValid: true,
      };
    }
  }

  // ── 3. Fall back to chrono-node for natural language ──────────────────────
  // Provide "today" as a reference point so chrono resolves relative dates
  const referenceDate = dayjs().tz(TZ).toDate();
  const chronoResult  = chrono.parseDate(input.trim(), referenceDate, { forwardDate: true });

  if (chronoResult) {
    // chrono returns a JS Date in local time — convert to driver timezone
    const date = dayjs(chronoResult).tz(TZ).startOf('day');
    return {
      date,
      dateStr: date.format('D-MMM-YYYY'),
      isValid: true,
    };
  }

  // ── 4. Nothing worked ─────────────────────────────────────────────────────
  return {
    isValid: false,
    error:
      `I couldn't understand the date *"${input}"*.\n` +
      'Please use a format like:\n' +
      '  • *today*\n' +
      '  • *tomorrow*\n' +
      '  • *10-Jul-2026*\n' +
      '  • *2026-07-10*',
  };
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseTimeRange()
 * ───────────────────────────────────────────────────────────────────────────
 * Parses a user-supplied time range string into { startHour, startMin,
 * endHour, endMin } integers (24-hour).
 *
 * Supported inputs:
 *   "8am-11am"      → { startHour: 8,  startMin: 0,  endHour: 11, endMin: 0 }
 *   "2pm-5:30pm"    → { startHour: 14, startMin: 0,  endHour: 17, endMin: 30 }
 *   "08:00-11:00"   → { startHour: 8,  startMin: 0,  endHour: 11, endMin: 0 }
 *   "14:00-17:30"   → { startHour: 14, startMin: 0,  endHour: 17, endMin: 30 }
 *
 * @param   {string} input - Raw user time range string
 * @returns {{ startHour: number, startMin: number, endHour: number, endMin: number, isValid: boolean, error?: string }}
 */
const parseTimeRange = (input) => {
  if (!input || typeof input !== 'string') {
    return { isValid: false, error: 'No time range input provided.' };
  }

  const match = input.trim().match(TIME_RANGE_REGEX);

  if (!match) {
    return {
      isValid: false,
      error:
        `I couldn't understand the time range *"${input}"*.\n` +
        'Please use a format like:\n' +
        '  • *8am-11am*\n' +
        '  • *2pm-5:30pm*\n' +
        '  • *08:00-17:00*',
    };
  }

  const [, sH, sM, sPeriod, eH, eM, ePeriod] = match;

  const startHour = to24Hour(sH, sPeriod);
  const startMin  = sM ? parseInt(sM, 10) : 0;
  const endHour   = to24Hour(eH, ePeriod ?? sPeriod); // inherit am/pm if end omits it
  const endMin    = eM ? parseInt(eM, 10) : 0;

  // Basic sanity checks
  if (startHour > 23 || endHour > 23 || startMin > 59 || endMin > 59) {
    return { isValid: false, error: 'Time values are out of range (hours 0–23, minutes 0–59).' };
  }

  const startTotalMins = startHour * 60 + startMin;
  const endTotalMins   = endHour   * 60 + endMin;

  if (startTotalMins >= endTotalMins) {
    return {
      isValid: false,
      error: 'The end time must be after the start time.\nExample: *8am-11am* (not 11am-8am).',
    };
  }

  const durationMinutes = endTotalMins - startTotalMins;
  if (durationMinutes < config.driver.minSlotMinutes) {
    return {
      isValid: false,
      error:
        `Bookings must be at least *${config.driver.minSlotMinutes} minutes* long.\n` +
        `Your slot is only ${durationMinutes} minutes.`,
    };
  }

  return { startHour, startMin, endHour, endMin, isValid: true };
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildDateTimeRange()
 * ───────────────────────────────────────────────────────────────────────────
 * Combines a parsed date and a parsed time range into ISO 8601 datetime
 * strings suitable for the Google Calendar API.
 *
 * Also validates:
 *   - The slot falls within the driver's working hours
 *   - The slot is not in the past
 *
 * @param {dayjs.Dayjs} date        - Parsed date (from parseDate)
 * @param {object}      timeRange   - Parsed time range (from parseTimeRange)
 * @returns {{ startISO: string, endISO: string, isValid: boolean, error?: string, startDayjs: dayjs.Dayjs, endDayjs: dayjs.Dayjs }}
 */
const buildDateTimeRange = (date, timeRange) => {
  const { startHour, startMin, endHour, endMin } = timeRange;

  // Build full datetime objects in the driver timezone
  const startDt = date
    .clone()
    .hour(startHour)
    .minute(startMin)
    .second(0)
    .millisecond(0);

  const endDt = date
    .clone()
    .hour(endHour)
    .minute(endMin)
    .second(0)
    .millisecond(0);

  // ── Validate: not in the past ─────────────────────────────────────────────
  const now = dayjs().tz(TZ);
  if (startDt.isSameOrBefore(now)) {
    return {
      isValid: false,
      error: `That time slot is in the past. Please choose a future date and time.`,
    };
  }

  // ── Validate: within working hours ───────────────────────────────────────
  const [workStartH, workStartM] = config.driver.workStart.split(':').map(Number);
  const [workEndH,   workEndM]   = config.driver.workEnd.split(':').map(Number);

  const workStartMins = workStartH * 60 + workStartM;
  const workEndMins   = workEndH   * 60 + workEndM;
  const slotStartMins = startHour  * 60 + startMin;
  const slotEndMins   = endHour    * 60 + endMin;

  if (slotStartMins < workStartMins || slotEndMins > workEndMins) {
    return {
      isValid: false,
      error:
        `The driver's working hours are *${config.driver.workStart}–${config.driver.workEnd}*.\n` +
        `Please book within those hours.`,
    };
  }

  return {
    isValid:    true,
    startISO:   startDt.toISOString(),
    endISO:     endDt.toISOString(),
    startDayjs: startDt,
    endDayjs:   endDt,
  };
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * formatSlot()
 * ───────────────────────────────────────────────────────────────────────────
 * Formats a { start, end } ISO string pair into a human-readable string
 * for WhatsApp messages.
 *
 * @param {string} startISO - ISO 8601 start datetime
 * @param {string} endISO   - ISO 8601 end datetime
 * @returns {string}        - e.g. "Thu, 10 Jul 2026 • 8:00 AM – 11:00 AM"
 */
const formatSlot = (startISO, endISO) => {
  const start = dayjs(startISO).tz(TZ);
  const end   = dayjs(endISO).tz(TZ);

  const datePart = start.format('ddd, D MMM YYYY');
  const timePart = `${start.format('h:mm A')} – ${end.format('h:mm A')}`;

  return `${datePart} • ${timePart}`;
};

/**
 * formatDate()
 * ───────────────────────────────────────────────────────────────────────────
 * Formats a dayjs object or ISO string into the standard display date string.
 *
 * @param {dayjs.Dayjs|string} input
 * @returns {string} - e.g. "Thu, 10 Jul 2026"
 */
const formatDate = (input) => {
  const d = typeof input === 'string' ? dayjs(input).tz(TZ) : input.tz(TZ);
  return d.format('ddd, D MMM YYYY');
};

/**
 * nowInTz()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns the current moment as a dayjs object in the driver's timezone.
 * Centralised here so timezone is never hardcoded across the codebase.
 *
 * @returns {dayjs.Dayjs}
 */
const nowInTz = () => dayjs().tz(TZ);

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  parseDate,
  parseTimeRange,
  buildDateTimeRange,
  formatSlot,
  formatDate,
  nowInTz,
};
