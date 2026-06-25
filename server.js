import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sql from "mssql";

import webhookRoutes from './routes/webhook.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import healthRoutes from './routes/health.routes.js';

import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import dbConfig from "./config/db.js";

// ─────────────────────────────────────────────────────────────
// DB CONNECTION (FIXED)
// ─────────────────────────────────────────────────────────────
async function connectDB() {
  try {
    await sql.connect(dbConfig);
    console.log("✅ Connected to SQL Server");
  } catch (err) {
    console.error("❌ DB Connection Failed:", err);
    process.exit(1); // 🔥 stop server if DB is critical
  }
}

// ─────────────────────────────────────────────────────────────
// ENV VALIDATION
// ─────────────────────────────────────────────────────────────
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
  console.error(`[server] ❌ Missing env vars:\n  ${missingEnv.join('\n  ')}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// EXPRESS APP
// ─────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────
app.use('/health', healthRoutes);
app.use('/api/v1/webhook', webhookRoutes);
app.use('/api/v1/bookings', bookingRoutes);

// ─────────────────────────────────────────────────────────────
// ERROR HANDLERS
// ─────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────
// START SERVER (FIXED BOOT ORDER)
// ─────────────────────────────────────────────────────────────
async function startServer() {
  await connectDB(); // 🔥 IMPORTANT FIX

  const server = app.listen(PORT, () => {
    console.log(`[server] ✅ Driver Booking Bot running on ${PORT}`);
    console.log(`[server] 🌍 ${process.env.NODE_ENV || 'development'}`);
  });

  // ───────── graceful shutdown ─────────
  const shutdown = (signal) => {
    console.log(`\n[server] 🛑 ${signal} received`);
    server.close(() => {
      console.log('[server] 👋 Server closed');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[server] ⚠️ Forced shutdown');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('[server] 🔥 Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[server] 💥 Uncaught Exception:', err);
    process.exit(1);
  });

  return server;
}

// ─────────────────────────────────────────────────────────────
// BOOT APP
// ─────────────────────────────────────────────────────────────
startServer();

export default app;