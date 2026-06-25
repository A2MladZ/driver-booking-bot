/**
 * routes/webhook.routes.js
 * Mounted at: /api/v1/webhook
 */

import { Router } from 'express';
import { verifyWebhook, handleIncoming } from '../controllers/webhookController.js';

const router = Router();

router.get('/',  verifyWebhook);
router.post('/', handleIncoming);

export default router;