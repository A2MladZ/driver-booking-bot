/**
 * routes/webhook.routes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express router for the WhatsApp Cloud API webhook.
 *
 * Mounted at: /api/v1/webhook  (see server.js)
 *
 * Routes:
 *   GET  /api/v1/webhook  → Webhook verification challenge (Meta one-time setup)
 *   POST /api/v1/webhook  → Incoming WhatsApp messages and status updates
 *
 * Design rule:
 *   Routes only map HTTP method + path → controller function.
 *   No logic, no middleware, no inline handlers here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';
import { verifyWebhook, handleIncoming } from '../controllers/webhookController.js';

const router = Router();

/**
 * GET /api/v1/webhook
 *
 * Meta sends this request once when you register or update your webhook URL
 * in the Meta Developer Portal. It passes hub.mode, hub.verify_token, and
 * hub.challenge as query parameters. We must respond with hub.challenge to
 * confirm ownership of the endpoint.
 */
router.get('/', verifyWebhook);

/**
 * POST /api/v1/webhook
 *
 * Meta sends all WhatsApp events here:
 *   - Incoming text messages from customers
 *   - Message delivery / read status updates
 *   - Other event types (reactions, media, etc.) — currently ignored
 *
 * Must respond with HTTP 200 immediately. See webhookController for details
 * on why (Meta retry policy).
 */
router.post('/', handleIncoming);

export default router;