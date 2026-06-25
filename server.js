/**
 * server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Application entry point.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sql from 'mssql';
import dbConfig from './config/db.js';

// ── Route modules ─────────────────────────────────────────────────────────────
import chatRoutes    from './routes/chat.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import healthRoutes  from './routes/health.routes.js';

// ── Middleware ────────────────────────────────────────────────────────────────
import { errorHandler }   from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';

// ── Logger ────────────────────────────────────────────────────────────────────
import logger from './utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. DB Connection
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
// 2. Validate critical environment variables
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'PORT',
  'GOOGLE_CHAT_PROJECT_NUMBER',
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
// 3. Create Express app
// ─────────────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// 4. Global middleware
// ─────────────────────────────────────────────────────────────────────────────
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
// 5. Route registration
// ─────────────────────────────────────────────────────────────────────────────
app.use('/health',          healthRoutes);
app.use('/api/v1/chat',     chatRoutes);
app.use('/api/v1/bookings', bookingRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Start HTTP server
// ─────────────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`Driver Booking Bot listening on port ${PORT}`,           { source: 'server' });
  logger.info(`Environment  : ${process.env.NODE_ENV || 'development'}`,{ source: 'server' });
  logger.info(`Calendar ID  : ${process.env.GOOGLE_CALENDAR_ID}`,      { source: 'server' });
  logger.info(`Chat Project : ${process.env.GOOGLE_CHAT_PROJECT_NUMBER}`,{ source: 'server' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.warn(`Received ${signal}. Shutting down gracefully…`, { source: 'server' });
  server.close(() => {
    logger.info('HTTP server closed. Goodbye.', { source: 'server' });
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout.', { source: 'server' });
    process.exit(1);
  }, 10_000);
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