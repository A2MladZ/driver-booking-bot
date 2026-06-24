/**
 * utils/logger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured application logger.
 *
 * Why not just console.log?
 *   - Adds log levels (info, warn, error, debug) so you can filter noise
 *   - Always includes a timestamp
 *   - In production, outputs JSON so log aggregators (Datadog, CloudWatch,
 *     Logtail) can parse and index fields without regex
 *   - In development, outputs coloured human-readable text
 *   - Centralises log formatting — one change here affects the whole app
 *
 * Usage:
 *   import logger from '../utils/logger.js';
 *   logger.info('Server started', { port: 3000 });
 *   logger.error('Calendar call failed', { error: err.message });
 *   logger.debug('Parsed command', { intent, args });   ← dev only
 * ─────────────────────────────────────────────────────────────────────────────
 */

import config from '../config/env.js';
import { getPool, sql } from '../config/sqlPool.js';

// ─────────────────────────────────────────────────────────────────────────────
// Log level constants and priority ordering
// ─────────────────────────────────────────────────────────────────────────────

const LEVELS = Object.freeze({
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
});

/**
 * Active log level — set via LOG_LEVEL env var or defaults to:
 *   development → DEBUG (show everything)
 *   production  → INFO  (suppress debug noise)
 */
const ACTIVE_LEVEL = LEVELS[
  (process.env.LOG_LEVEL ?? (config.isDev ? 'DEBUG' : 'INFO')).toUpperCase()
] ?? LEVELS.INFO;

// ─────────────────────────────────────────────────────────────────────────────
// ANSI colour codes for development output
// ─────────────────────────────────────────────────────────────────────────────

const COLOURS = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  blue:   '\x1b[34m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
};

const LEVEL_COLOURS = {
  DEBUG: COLOURS.cyan,
  INFO:  COLOURS.blue,
  WARN:  COLOURS.yellow,
  ERROR: COLOURS.red,
};

// ─────────────────────────────────────────────────────────────────────────────
// SQL Server persistence
// ─────────────────────────────────────────────────────────────────────────────

const writeToSql = async (level, message, meta, timestamp) => {
  try {
    const pool = await getPool();

    await pool
      .request()
      .input('level', sql.NVarChar(20), level)
      .input('message', sql.NVarChar(sql.MAX), message)
      .input(
        'meta',
        sql.NVarChar(sql.MAX),
        Object.keys(meta).length ? JSON.stringify(meta) : null
      )
      .input('timestamp', sql.DateTime2, new Date(timestamp))
      .query(`
        INSERT INTO ApplicationLogs
        (Level, Message, Meta, Timestamp)
        VALUES
        (@level, @message, @meta, @timestamp)
      `);
  } catch (err) {
    // Ignore SQL failures so logging never crashes the app
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Core log function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * log()
 * ───────────────────────────────────────────────────────────────────────────
 * Internal log dispatcher. Called by the public-facing level methods.
 *
 * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
 * @param {string}  message - Primary log message
 * @param {object}  [meta]  - Optional structured metadata
 */
const log = (level, message, meta = {}) => {
  // Suppress messages below the active level
  if (LEVELS[level] < ACTIVE_LEVEL) return;

  const timestamp = new Date().toISOString();

  if (config.isProd) {
    // ── Production: structured JSON ──────────────────────────────────────────
    // Log aggregators expect newline-delimited JSON
    const entry = {
      timestamp,
      level,
      message,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    };
    const output = JSON.stringify(entry);

    if (level === 'ERROR') {
      console.error(output);
    } else if (level === 'WARN') {
      console.warn(output);
    } else {
      console.log(output);
    }

  } else {
    // ── Development: human-readable coloured output ───────────────────────
    const colour    = LEVEL_COLOURS[level] ?? COLOURS.reset;
    const levelTag  = `${colour}[${level.padEnd(5)}]${COLOURS.reset}`;
    const timeTag   = `${COLOURS.dim}${timestamp}${COLOURS.reset}`;
    const metaStr   = Object.keys(meta).length > 0
      ? ` ${COLOURS.dim}${JSON.stringify(meta)}${COLOURS.reset}`
      : '';

    const output = `${timeTag} ${levelTag} ${message}${metaStr}`;

    if (level === 'ERROR') {
      console.error(output);
    } else if (level === 'WARN') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  writeToSql(level, message, meta, timestamp);
};

// ─────────────────────────────────────────────────────────────────────────────
// Public logger interface
// ─────────────────────────────────────────────────────────────────────────────

const logger = {
  /**
   * Detailed diagnostic info — development only.
   * Suppressed in production unless LOG_LEVEL=DEBUG is set.
   * @param {string} message
   * @param {object} [meta]
   */
  debug: (message, meta) => log('DEBUG', message, meta),

  /**
   * General operational events — server started, booking created, etc.
   * @param {string} message
   * @param {object} [meta]
   */
  info: (message, meta) => log('INFO', message, meta),

  /**
   * Something unexpected happened but the app is still running.
   * @param {string} message
   * @param {object} [meta]
   */
  warn: (message, meta) => log('WARN', message, meta),

  /**
   * A failure that needs attention — failed API call, unhandled exception, etc.
   * @param {string} message
   * @param {object|Error} [metaOrError]
   */
  error: (message, metaOrError) => {
    if (metaOrError instanceof Error) {
      log('ERROR', message, {
        error:  metaOrError.message,
        name:   metaOrError.name,
        stack:  config.isDev ? metaOrError.stack : undefined,
      });
    } else {
      log('ERROR', message, metaOrError);
    }
  },

  /**
   * Logs an incoming WhatsApp message event.
   * Convenience wrapper with a consistent structure for message events.
   *
   * @param {string} phone   - Sender phone number
   * @param {string} text    - Message text
   * @param {string} intent  - Parsed intent
   */
  message: (phone, text, intent) =>
    log('INFO', `📨 WhatsApp message`, { from: phone, text, intent }),

  /**
   * Logs an outbound WhatsApp message event.
   *
   * @param {string} phone     - Recipient phone number
   * @param {string} messageId - Returned message ID from WhatsApp API
   */
  sent: (phone, messageId) =>
    log('INFO', `📤 WhatsApp reply sent`, { to: phone, messageId }),

  /**
   * Logs a Google Calendar API operation.
   *
   * @param {string} operation - e.g. "FreeBusy query", "event.insert"
   * @param {object} [meta]
   */
  calendar: (operation, meta) =>
    log('INFO', `📅 Calendar: ${operation}`, meta),
};

export default logger;