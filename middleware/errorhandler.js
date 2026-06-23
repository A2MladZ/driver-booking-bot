/**
 * middleware/errorHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Global Express error handling middleware.
 *
 * Express identifies error-handling middleware by its 4-argument signature:
 *   (err, req, res, next)
 * It must be registered LAST in server.js, after all routes.
 *
 * Responsibilities:
 *   - Catch any error passed via next(err) from routes or controllers
 *   - Log the full error server-side (with stack in development)
 *   - Return a clean, consistent JSON error response to the client
 *   - Never leak internal stack traces or sensitive details to clients
 *   - Map known error types to appropriate HTTP status codes
 *
 * Error response envelope (always):
 *   {
 *     success:   false,
 *     error:     "Human-readable message",
 *     code:      "ERROR_CODE",        ← optional, for client-side handling
 *     requestId: "uuid",              ← correlates logs to responses
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'crypto';
import config from '../config/env.js';

/**
 * Maps error names / codes to HTTP status codes.
 * Extend this map as new error types are introduced.
 */
const ERROR_STATUS_MAP = {
  ValidationError:    400,
  BadRequestError:    400,
  UnauthorizedError:  401,
  ForbiddenError:     403,
  NotFoundError:      404,
  ConflictError:      409,
  RateLimitError:     429,
  InternalError:      500,
  ServiceUnavailable: 503,
};

/**
 * errorHandler()
 * ───────────────────────────────────────────────────────────────────────────
 * Global error handler — catches all errors passed to next(err).
 *
 * @param {Error}           err  - The error object
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next  - Must be declared even if unused
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // ── Generate a unique request ID for log correlation ──────────────────────
  const requestId = randomUUID();

  // ── Determine HTTP status code ────────────────────────────────────────────
  const status =
    err.statusCode ||
    err.status     ||
    ERROR_STATUS_MAP[err.name] ||
    ERROR_STATUS_MAP[err.code] ||
    500;

  // ── Log the full error server-side ────────────────────────────────────────
  // In production, send to your logging service (Datadog, CloudWatch, etc.)
  const logPayload = {
    requestId,
    method:  req.method,
    path:    req.path,
    status,
    error:   err.message,
    name:    err.name,
  };

  if (config.isDev) {
    // Full stack trace in development
    console.error('[errorHandler] 💥 Unhandled error:', { ...logPayload, stack: err.stack });
  } else {
    // Structured log in production — no stack trace (security)
    console.error('[errorHandler] 💥 Unhandled error:', JSON.stringify(logPayload));
  }

  // ── Build the client-facing response ──────────────────────────────────────
  // Never expose stack traces or internal error details to clients
  const clientMessage = status < 500
    ? err.message                                 // Client errors: show the reason
    : 'An unexpected error occurred. Please try again later.'; // Server errors: generic

  const response = {
    success:   false,
    error:     clientMessage,
    requestId,                                    // Let clients quote this in support tickets
  };

  // Attach error code if present (useful for client-side error handling)
  if (err.code && typeof err.code === 'string') {
    response.code = err.code;
  }

  // In development, include the stack for easier debugging
  if (config.isDev && err.stack) {
    response.stack = err.stack.split('\n');
  }

  return res.status(status).json(response);
};

export { errorHandler };