/**
 * middleware/notFoundHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 404 catch-all middleware.
 *
 * Registered after all routes in server.js so it only fires when no route
 * matched the incoming request. Returns a consistent JSON 404 response
 * instead of Express's default HTML "Cannot GET /path" page.
 *
 * This is regular middleware (3 args), NOT an error handler (4 args).
 * It creates a 404 error and passes it to the global errorHandler via next()
 * so all error formatting stays in one place.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * notFoundHandler()
 * ───────────────────────────────────────────────────────────────────────────
 * Catches all requests that didn't match any registered route.
 *
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction} next
 */
const notFoundHandler = (req, res, next) => {
  const err        = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode   = 404;
  err.name         = 'NotFoundError';
  err.code         = 'ROUTE_NOT_FOUND';

  // Log at warn level — 404s are expected noise, not application errors
  console.warn(`[notFoundHandler] ⚠️  404: ${req.method} ${req.originalUrl}`);

  // Pass to errorHandler for consistent JSON formatting
  next(err);
};

export { notFoundHandler };