/**
 * routes/chat.routes.js
 * Mounted at: /api/v1/chat
 *
 * POST /api/v1/chat  → All Google Chat events (messages, add/remove)
 */

import { Router } from 'express';
import { handleChatEvent } from '../controllers/chatController.js';

const router = Router();

router.post('/', handleChatEvent);

export default router;
