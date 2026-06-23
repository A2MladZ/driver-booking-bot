/**
 * utils/messageParser.js
 * ─────────────────────────────────────────────────────────────────────────────
 * WhatsApp message command parser.
 *
 * Responsibilities:
 *   - Receive raw message text from a WhatsApp user
 *   - Identify which command (intent) the user is expressing
 *   - Extract structured arguments from the message
 *   - Return a clean ParsedCommand object for the controller to dispatch
 *
 * Supported commands:
 *   availability today
 *   availability tomorrow
 *   availability 10-Jul-2026
 *
 *   book 10-Jul-2026 8am-11am
 *   book today 2pm-5pm
 *   book tomorrow 09:00-13:00
 *
 *   cancel BK-xxxxxxxx
 *
 *   my bookings
 *
 *   help  (or any unrecognised input)
 *
 * Design notes:
 *   - All matching is case-insensitive.
 *   - Patterns are tried in priority order (most specific first).
 *   - The parser is pure — it does NOT call any external service. It only
 *     identifies intent and extracts raw tokens. Validation of dates/times
 *     happens downstream in dateParser.js and the calendar service.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// Intent constants — used as discriminated union tags throughout the app
// ─────────────────────────────────────────────────────────────────────────────

export const INTENTS = Object.freeze({
  AVAILABILITY: 'AVAILABILITY',
  BOOK:         'BOOK',
  CANCEL:       'CANCEL',
  MY_BOOKINGS:  'MY_BOOKINGS',
  HELP:         'HELP',
  UNKNOWN:      'UNKNOWN',
});

// ─────────────────────────────────────────────────────────────────────────────
// Command pattern definitions
// Each entry has:
//   intent   — one of INTENTS
//   pattern  — RegExp tested against the normalised message
//   extract  — function that pulls structured args out of the regex match
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Booking reference pattern — BK- followed by 8 hex chars (UUID prefix).
 * Example: BK-3f2504e0
 */
const BOOKING_REF_PATTERN = /BK-[0-9a-f]{8}/i;

/**
 * Date token — matches explicit dates or relative keywords.
 * Examples: "today", "tomorrow", "10-Jul-2026", "2026-07-10", "10/07/2026"
 */
const DATE_TOKEN = /today|tomorrow|(?:\d{1,2}[-/]\w+[-/]\d{2,4})|(?:\d{4}-\d{2}-\d{2})/i;

/**
 * Time range token — matches patterns like "8am-11am", "08:00-17:00", "2pm-5:30pm".
 */
const TIME_RANGE_TOKEN = /\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–to]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i;

// ── Pattern table (evaluated top-to-bottom, first match wins) ─────────────────

const COMMAND_PATTERNS = [

  // ── "my bookings" / "mybookings" / "show bookings" / "list bookings" ───────
  {
    intent: INTENTS.MY_BOOKINGS,
    pattern: /^(?:my\s+bookings?|show\s+(?:my\s+)?bookings?|list\s+(?:my\s+)?bookings?|view\s+(?:my\s+)?bookings?)$/i,
    extract: () => ({}),
  },

  // ── "help" / "hi" / "hello" / "start" / "menu" ───────────────────────────
  {
    intent: INTENTS.HELP,
    pattern: /^(?:help|hi|hello|hey|start|menu|commands?|what can you do)$/i,
    extract: () => ({}),
  },

  // ── "cancel BK-xxxxxxxx" ──────────────────────────────────────────────────
  {
    intent: INTENTS.CANCEL,
    pattern: /^cancel\s+(BK-[0-9a-f]{8})/i,
    extract: (match) => ({
      bookingRef: match[1].toUpperCase(),
    }),
  },

  // ── "book <date> <time-range>" ────────────────────────────────────────────
  // Examples:
  //   book today 8am-11am
  //   book tomorrow 14:00-17:00
  //   book 10-Jul-2026 2pm-5:30pm
  {
    intent: INTENTS.BOOK,
    pattern: new RegExp(
      `^book\\s+(${DATE_TOKEN.source})\\s+(${TIME_RANGE_TOKEN.source})$`,
      'i'
    ),
    extract: (match, raw) => {
      // Re-extract date and time range tokens from the raw text because
      // the combined regex capture groups can be unreliable with alternations.
      const withoutCommand = raw.replace(/^book\s+/i, '').trim();
      const timeRangeMatch = withoutCommand.match(TIME_RANGE_TOKEN);
      const timeRange      = timeRangeMatch ? timeRangeMatch[0].trim() : null;
      const dateStr        = timeRange
        ? withoutCommand.slice(0, withoutCommand.lastIndexOf(timeRange)).trim()
        : null;

      return { dateStr, timeRange };
    },
  },

  // ── "availability <date>" ─────────────────────────────────────────────────
  // Examples:
  //   availability today
  //   availability tomorrow
  //   availability 10-Jul-2026
  //   check availability tomorrow
  //   available today
  {
    intent: INTENTS.AVAILABILITY,
    pattern: new RegExp(
      `^(?:check\\s+)?(?:availability|available|avail|avl)\\s+(${DATE_TOKEN.source}.*)$`,
      'i'
    ),
    extract: (match) => ({
      dateStr: match[1].trim(),
    }),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main parser function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseMessage()
 * ───────────────────────────────────────────────────────────────────────────
 * Parses a raw WhatsApp message string into a structured ParsedCommand object.
 *
 * @param {string} rawText - The raw text content of the WhatsApp message
 * @returns {ParsedCommand}
 *
 * @typedef  {object} ParsedCommand
 * @property {string}  intent      - One of INTENTS.*
 * @property {string}  raw         - Original trimmed message text
 * @property {string}  normalised  - Lowercased, whitespace-collapsed text
 * @property {object}  args        - Extracted arguments (intent-specific)
 * @property {boolean} recognised  - false if no pattern matched
 *
 * Args shape by intent:
 *   AVAILABILITY : { dateStr: string }
 *   BOOK         : { dateStr: string, timeRange: string }
 *   CANCEL       : { bookingRef: string }
 *   MY_BOOKINGS  : {}
 *   HELP         : {}
 *   UNKNOWN      : {}
 */
const parseMessage = (rawText) => {
  // ── Normalise input ───────────────────────────────────────────────────────
  const raw        = (rawText ?? '').trim();
  const normalised = raw.replace(/\s+/g, ' ').toLowerCase();

  if (!raw) {
    return {
      intent:      INTENTS.UNKNOWN,
      raw:         '',
      normalised:  '',
      args:        {},
      recognised:  false,
    };
  }

  // ── Try each pattern in priority order ───────────────────────────────────
  for (const { intent, pattern, extract } of COMMAND_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      return {
        intent,
        raw,
        normalised,
        args:       extract(match, raw),
        recognised: true,
      };
    }
  }

  // ── No pattern matched — check if it looks like a partial command ─────────
  // This gives more helpful error messages than the generic "I don't understand"
  const partialIntent = detectPartialIntent(normalised);

  return {
    intent:      INTENTS.UNKNOWN,
    raw,
    normalised,
    args:        { partialIntent },
    recognised:  false,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Partial intent detector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * detectPartialIntent()
 * ───────────────────────────────────────────────────────────────────────────
 * Detects if the user typed a command keyword but with incorrect/missing
 * arguments. Used to give targeted correction hints.
 *
 * @param {string} normalised - Lowercased, collapsed message text
 * @returns {string|null}     - The detected partial intent or null
 */
const detectPartialIntent = (normalised) => {
  if (/^availability|^available|^avail/.test(normalised)) return 'AVAILABILITY_INCOMPLETE';
  if (/^book/.test(normalised))                            return 'BOOK_INCOMPLETE';
  if (/^cancel/.test(normalised))                         return 'CANCEL_INCOMPLETE';
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable command hints (used in help and error messages)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getCommandHint()
 * ───────────────────────────────────────────────────────────────────────────
 * Returns a targeted correction hint for partial/malformed commands.
 * Called by the message handler when intent is UNKNOWN.
 *
 * @param {string|null} partialIntent
 * @returns {string} WhatsApp-formatted hint string
 */
const getCommandHint = (partialIntent) => {
  switch (partialIntent) {
    case 'AVAILABILITY_INCOMPLETE':
      return (
        '📅 To check availability, include a date:\n\n' +
        '  *availability today*\n' +
        '  *availability tomorrow*\n' +
        '  *availability 10-Jul-2026*'
      );

    case 'BOOK_INCOMPLETE':
      return (
        '📋 To book, include a date and time range:\n\n' +
        '  *book today 8am-11am*\n' +
        '  *book tomorrow 2pm-5pm*\n' +
        '  *book 10-Jul-2026 09:00-13:00*'
      );

    case 'CANCEL_INCOMPLETE':
      return (
        '❌ To cancel, include your booking reference:\n\n' +
        '  *cancel BK-3f2504e0*\n\n' +
        'Use *my bookings* to see your booking references.'
      );

    default:
      return null; // Caller will show the full help menu
  }
};

// Use async import to avoid circular dependency issues with config
let _helpMenuCache = null;

/**
 * buildHelpMenu()
 * Builds the help menu string dynamically using config values.
 * Cached after first call.
 *
 * @returns {Promise<string>}
 */
const buildHelpMenu = async () => {
  if (_helpMenuCache) return _helpMenuCache;

  const { default: config } = await import('../config/env.js');

  _helpMenuCache =
    `👋 *Driver Booking Bot*\n\n` +
    `Here's what I can help you with:\n\n` +
    `📅 *Check Availability*\n` +
    `  availability today\n` +
    `  availability tomorrow\n` +
    `  availability 10-Jul-2026\n\n` +
    `📋 *Book a Slot*\n` +
    `  book today 8am-11am\n` +
    `  book tomorrow 2pm-5pm\n` +
    `  book 10-Jul-2026 09:00-13:00\n\n` +
    `❌ *Cancel a Booking*\n` +
    `  cancel BK-3f2504e0\n\n` +
    `📂 *View Your Bookings*\n` +
    `  my bookings\n\n` +
    `ℹ️  *Help*\n` +
    `  help\n\n` +
    `_Working hours: ${config.driver.workStart} – ${config.driver.workEnd}_\n` +
    `_Minimum booking: ${config.driver.minSlotMinutes} minutes_`;

  return _helpMenuCache;
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  parseMessage,
  getCommandHint,
  buildHelpMenu,
  BOOKING_REF_PATTERN,
  DATE_TOKEN,
  TIME_RANGE_TOKEN,
};
