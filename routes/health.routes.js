/**
 * routes/health.routes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express router for the application health check endpoint.
 *
 * Mounted at: /health  (see server.js)
 *
 * Routes:
 *   GET /health  → Returns server status, uptime, and environment info
 *
 * Used by:
 *   - Load balancers (AWS ALB, GCP LB) to determine instance health
 *   - Container orchestrators (Docker, Kubernetes) for readiness probes
 *   - Uptime monitors (UptimeRobot, BetterUptime) for alerting
 *   - Render / Railway / Fly.io platform health checks
 *
 * No auth required — health checks must be publicly accessible.
 * No sensitive data is exposed — only safe operational metadata.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';
import config from '../config/env.js';

const router = Router();

/**
 * GET /health
 *
 * Returns a JSON payload with:
 *   status      → "ok" (always, if the server is up)
 *   uptime      → process uptime in seconds
 *   timestamp   → current UTC ISO timestamp
 *   environment → NODE_ENV value
 *   version     → app version (from package.json via env, or "unknown")
 *   services    → named service connectivity indicators
 *
 * HTTP 200 = healthy
 * HTTP 503 = unhealthy (reserved for future deep health checks)
 */
router.get('/', (_req, res) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const hours         = Math.floor(uptimeSeconds / 3600);
  const minutes       = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds       = uptimeSeconds % 60;

  res.status(200).json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: uptimeSeconds,
      human:   `${hours}h ${minutes}m ${seconds}s`,
    },
    environment: config.nodeEnv,
    services: {
      // These show configuration status, not live connectivity.
      // For live connectivity checks, see verifyCalendarConnection() in startup.
      whatsapp: {
        configured: Boolean(config.whatsapp.accessToken),
        phoneNumberId: config.whatsapp.phoneNumberId,
        apiVersion:    config.whatsapp.apiVersion,
      },
      googleCalendar: {
        configured: Boolean(config.google.privateKey),
        calendarId: config.google.calendarId,
      },
      driver: {
        timezone:       config.driver.timezone,
        workingHours:  `${config.driver.workStart} – ${config.driver.workEnd}`,
        minSlotMinutes: config.driver.minSlotMinutes,
      },
    },
    memory: {
      // Useful for spotting memory leaks in long-running processes
      heapUsedMB:  Math.round(process.memoryUsage().heapUsed  / 1024 / 1024),
      heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rssMB:       Math.round(process.memoryUsage().rss       / 1024 / 1024),
    },
  });
});

export default router;