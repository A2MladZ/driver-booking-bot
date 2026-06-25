/**
 * server.js
 */

import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sql from 'mssql';
import dbConfig from './config/db.js';

import webhookRoutes from './routes/webhook.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import healthRoutes  from './routes/health.routes.js';

import { errorHandler }    from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';

import logger from './utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// SSE — activity event bus
// ─────────────────────────────────────────────────────────────────────────────

const sseClients = new Set();

/**
 * Broadcast a live activity event to all connected SSE clients.
 * type: 'booking_created' | 'booking_cancelled' | 'whatsapp_message' |
 *       'calendar_sync'   | 'system_error'       | 'system_info'
 */
export const broadcastEvent = (type, payload) => {
  const data = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  for (const res of sseClients) {
    try { res.write(`data: ${data}\n\n`); } catch { sseClients.delete(res); }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DB
// ─────────────────────────────────────────────────────────────────────────────
async function connectDB() {
  try {
    await sql.connect(dbConfig);
    logger.info('Connected to SQL Server', { source: 'server' });
  } catch (err) {
    logger.error('DB Connection Failed', { source: 'server', error: err.message });
  }
}

await connectDB();

// ─────────────────────────────────────────────────────────────────────────────
// Env validation
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
  console.error(`[server] ❌ Missing required environment variables:\n  ${missingEnv.join('\n  ')}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// SSE route — GET /api/v1/events
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send a heartbeat immediately so the client knows it's connected
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`);

  sseClients.add(res);

  // Heartbeat every 25 s to prevent proxy timeouts
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
  }, 25_000);

  req.on('close', () => {
    clearInterval(hb);
    sseClients.delete(res);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
app.use('/health',          healthRoutes);
app.use('/api/v1/webhook',  webhookRoutes);
app.use('/api/v1/bookings', bookingRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`Driver Booking Bot listening on port ${PORT}`,           { source: 'server' });
  logger.info(`Environment : ${process.env.NODE_ENV || 'development'}`, { source: 'server' });
  logger.info(`Calendar ID : ${process.env.GOOGLE_CALENDAR_ID}`,       { source: 'server' });
  logger.info(`WA Phone ID : ${process.env.WHATSAPP_PHONE_NUMBER_ID}`, { source: 'server' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.warn(`Received ${signal}. Shutting down gracefully…`, { source: 'server' });
  server.close(() => {
    logger.info('HTTP server closed. Goodbye.', { source: 'server' });
    process.exit(0);
  });
  setTimeout(() => { process.exit(1); }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { source: 'server', reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { source: 'server', error: err.message });
  process.exit(1);
});

export default app;