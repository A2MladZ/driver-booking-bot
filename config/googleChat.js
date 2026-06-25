/**
 * config/googleChat.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Authenticated Google Chat API client.
 *
 * Uses the same service account as Google Calendar — no extra credentials
 * needed. The service account must have the Google Chat API scope added
 * and must be configured as the Chat app in Google Cloud Console.
 *
 * Usage:
 *   import { chat } from './config/googleChat.js';
 *   await chat.spaces.messages.create({ parent: spaceName, requestBody: { text } });
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { google } from 'googleapis';
import config from './env.js';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: config.google.serviceAccountEmail,
    private_key:  config.google.privateKey,
  },
  scopes: [
    'https://www.googleapis.com/auth/chat.bot',
  ],
});

const chat = google.chat({ version: 'v1', auth });

export { chat, auth };
