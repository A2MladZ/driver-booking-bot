/**
 * middleware/requestLogger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Per-request structured logging middleware.
 *
 * Complements Morgan (which handles basic HTTP access logs) with a structured,
 * application-level log entry for every request that includes:
 *   - Request ID (generated here, attached to res.locals for downstream use)
 *   - Method, path, status code, response time
 *   - User-Agent (for detecting bots/scrapers)
 *   - IP address
 *
 * The requestId is attached to res.locals.requestId so it can be included
 * in error responses (errorHandler.js reads it from there if present).
 *
 * Usage:
 *   app.use(requestLogger);   ← register early in server.js middleware chain
 *
 * In production this emits one JSON log line per request, which log
 * aggregators (Datadog, CloudWatch, Logtail) can parse and index.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

/**
 * requestLogger()
 * ───────────────────────────────────────────────────────────────────────────
 * Express middleware that logs each request with timing and context.
 *
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction} next
 */
const requestLogger = (req, res, next) => {
  // ── Generate and attach a request ID ─────────────────────────────────────
  const requestId      = randomUUID();
  res.locals.requestId = requestId;

  // Attach to response headers so clients/proxies can correlate requests
  res.setHeader('X-Request-Id', requestId);

  // ── Record start time ─────────────────────────────────────────────────────
  const startTime = Date.now();

  // ── Log on response finish ────────────────────────────────────────────────
  // Use 'finish' (response sent) not 'close' (connection closed) so we
  // always get the status code even on keep-alive connections.
  res.on('finish', () => {
    const duration   = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Skip logging for health checks — they're noisy and not interesting
    if (req.path === '/health') return;

    const meta = {
      requestId,
      method:    req.method,
      path:      req.originalUrl,
      status:    statusCode,
      durationMs: duration,
      ip:        req.ip || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'] ?? 'unknown',
    };

    // Use appropriate log level based on status code
    if (statusCode >= 500) {
      logger.error(`${req.method} ${req.originalUrl} ${statusCode} (${duration}ms)`, meta);
    } else if (statusCode >= 400) {
      logger.warn(`${req.method} ${req.originalUrl} ${statusCode} (${duration}ms)`, meta);
    } else {
      logger.info(`${req.method} ${req.originalUrl} ${statusCode} (${duration}ms)`, meta);
    }
  });

  next();
};

export { requestLogger };