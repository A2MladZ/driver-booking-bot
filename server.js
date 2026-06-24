/**
 * server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Application entry point.
 *
 * Responsibilities:
 *  - Load environment variables from .env
 *  - Create and configure the Express application
 *  - Register global middleware (logger, body parser, security headers)
 *  - Mount all route handlers under versioned prefixes
 *  - Start the HTTP server and bind to the configured PORT
 *  - Handle graceful shutdown on SIGTERM / SIGINT
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';                    // Must be first — loads .env into process.env
import express from 'express';
import morgan from 'morgan';

// ── Route modules ─────────────────────────────────────────────────────────────
import webhookRoutes from './routes/webhook.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import healthRoutes  from './routes/health.routes.js';

// ── Global error handler middleware ──────────────────────────────────────────
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import sql from "mssql";
import dbConfig from "./config/db.js";

async function connectDB() {
  try {
    await sql.connect(dbConfig);
    console.log("✅ Connected to SQL Server");
  } catch (err) {
    console.log("❌ DB Connection Failed:", err);
  }
}

connectDB();
// ─────────────────────────────────────────────────────────────────────────────
// 1. Validate critical environment variables at startup
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'PORT',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'GOOGLE_CALENDAR_ID',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(
    `[server] ❌ Missing required environment variables:\n  ${missingEnv.join('\n  ')}`
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Create Express app
// ─────────────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Global middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HTTP request logger.
 * In production use 'combined' (Apache format) for structured log aggregators.
 * In development use 'dev' for colour-coded, concise output.
 */
app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev')
);

/**
 * Parse incoming JSON request bodies.
 * Limit kept at 1mb — WhatsApp webhooks are never large, but this guards
 * against accidental oversized payloads.
 */
app.use(express.json({ limit: '1mb' }));

/**
 * Parse URL-encoded bodies (form submissions, if any).
 */
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/**
 * Minimal security headers — not a replacement for helmet, but covers the
 * basics for a webhook-only service:
 *   - X-Content-Type-Options: prevents MIME-type sniffing
 *   - X-Frame-Options:        prevents clickjacking
 *   - X-XSS-Protection:       legacy browser XSS filter
 */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Route registration
// ─────────────────────────────────────────────────────────────────────────────
console.log("👉 REGISTERING ROUTES NOW");
/**
 * Health-check — no auth required.
 * GET /health  →  200 { status: "ok", uptime: ... }
 */
app.use('/health', healthRoutes);

/**
 * WhatsApp Cloud API webhook.
 * GET  /api/v1/webhook  →  challenge verification (Meta sends this once)
 * POST /api/v1/webhook  →  incoming messages & status updates
 */
app.use('/api/v1/webhook', webhookRoutes);

/**
 * Internal booking management REST endpoints (optional — useful for an admin
 * dashboard or debugging without going through WhatsApp).
 * GET    /api/v1/bookings          →  list all bookings
 * GET    /api/v1/bookings/:ref     →  get single booking
 * DELETE /api/v1/bookings/:ref     →  cancel booking
 */
app.use('/api/v1/bookings', bookingRoutes);
console.log("👉 booking route mounted at /api/v1/bookings");
// ─────────────────────────────────────────────────────────────────────────────
// 5. 404 and global error handlers (must be registered LAST)
// ─────────────────────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Start the HTTP server
// ─────────────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[server] ✅ Driver Booking Bot listening on port ${PORT}`);
  console.log(`[server] 🌍 Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`[server] 📅 Calendar ID : ${process.env.GOOGLE_CALENDAR_ID}`);
  console.log(`[server] 📱 WA Phone ID : ${process.env.WHATSAPP_PHONE_NUMBER_ID}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Graceful shutdown
//    - On SIGTERM (container stop / Heroku/Render dyno restart) or SIGINT
//      (Ctrl-C in dev), stop accepting new connections, then close existing
//      ones cleanly before exiting.
// ─────────────────────────────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\n[server] 🛑 Received ${signal}. Shutting down gracefully…`);
  server.close(() => {
    console.log('[server] 👋 HTTP server closed. Goodbye.');
    process.exit(0);
  });

  // Force-exit after 10 seconds if connections remain open
  setTimeout(() => {
    console.error('[server] ⚠️  Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

/**
 * Catch unhandled promise rejections — log them but don't crash the process
 * unless they're truly unrecoverable.  In production, a process manager
 * (PM2 / Docker restart policy) will handle restarts.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[server] 🔥 Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] 💥 Uncaught Exception:', err);
  process.exit(1);   // Always exit on uncaught exceptions — state is unknown
});

export default app; // Export for testing