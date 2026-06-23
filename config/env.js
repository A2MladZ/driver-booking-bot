/**
 * config/env.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised environment configuration.
 *
 * Why this exists:
 *   - Raw process.env values are always strings and always optional from
 *     Node's perspective. Zod lets us declare exactly what we expect, coerce
 *     types (string → number, "true" → boolean), set defaults, and get a
 *     single structured error if anything is wrong — all at startup, not
 *     buried inside a request handler at 3 am.
 *
 *   - Every other module in the project imports `config` from here instead
 *     of reading process.env directly. This makes the dependency explicit and
 *     testable (just mock this module in tests).
 *
 * Usage:
 *   import config from './config/env.js';
 *   config.whatsapp.accessToken   // ✅ typed, validated
 *   process.env.WHATSAPP_ACCESS_TOKEN  // ❌ avoid — raw, unvalidated string
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Schema definition
// ─────────────────────────────────────────────────────────────────────────────

const envSchema = z.object({

  // ── Server ─────────────────────────────────────────────────────────────────
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
      message: 'PORT must be a valid port number (1–65535)',
    }),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // ── WhatsApp Cloud API ─────────────────────────────────────────────────────
  WHATSAPP_ACCESS_TOKEN: z
    .string()
    .min(10, 'WHATSAPP_ACCESS_TOKEN appears too short — check your Meta dashboard'),

  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .min(1, 'WHATSAPP_PHONE_NUMBER_ID is required'),

  WHATSAPP_VERIFY_TOKEN: z
    .string()
    .min(8, 'WHATSAPP_VERIFY_TOKEN should be at least 8 characters for security'),

  WHATSAPP_API_VERSION: z
    .string()
    .default('v19.0')
    .refine((v) => /^v\d+\.\d+$/.test(v), {
      message: 'WHATSAPP_API_VERSION must be in the format vXX.X (e.g. v19.0)',
    }),

  // ── Google Calendar API ────────────────────────────────────────────────────
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z
    .string()
    .email('GOOGLE_SERVICE_ACCOUNT_EMAIL must be a valid email address'),

  GOOGLE_PRIVATE_KEY: z
    .string()
    .min(100, 'GOOGLE_PRIVATE_KEY appears too short — paste the full RSA key')
    // Replace literal \n sequences (from .env file) with real newlines
    .transform((key) => key.replace(/\\n/g, '\n')),

  GOOGLE_CALENDAR_ID: z
    .string()
    .min(1, 'GOOGLE_CALENDAR_ID is required (use the driver\'s email or calendar ID)'),

  // ── Driver / Business Rules ────────────────────────────────────────────────
  DRIVER_TIMEZONE: z
    .string()
    .default('Asia/Kolkata')
    .refine(
      (tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'DRIVER_TIMEZONE must be a valid IANA timezone (e.g. Asia/Kolkata)' }
    ),

  DRIVER_WORK_START: z
    .string()
    .default('08:00')
    .refine((t) => /^\d{2}:\d{2}$/.test(t), {
      message: 'DRIVER_WORK_START must be in HH:mm format (e.g. 08:00)',
    }),

  DRIVER_WORK_END: z
    .string()
    .default('20:00')
    .refine((t) => /^\d{2}:\d{2}$/.test(t), {
      message: 'DRIVER_WORK_END must be in HH:mm format (e.g. 20:00)',
    }),

  DRIVER_MIN_SLOT_MINUTES: z
    .string()
    .default('60')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 15 && val <= 480, {
      message: 'DRIVER_MIN_SLOT_MINUTES must be between 15 and 480 minutes',
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Parse & validate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * safeParse lets us intercept errors and format them nicely instead of
 * letting Zod throw a raw ZodError with a wall of JSON.
 */
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map(
    (issue) => `  ❌  ${issue.path.join('.')} — ${issue.message}`
  );
  console.error('\n[config] Environment validation failed:\n');
  console.error(issues.join('\n'));
  console.error('\n  👉  Check your .env file against .env.example\n');
  process.exit(1);
}

const env = parsed.data;

// ─────────────────────────────────────────────────────────────────────────────
// Export a structured config object
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structured, namespaced config object.
 * Prefer this shape over a flat export so call-sites are self-documenting:
 *   config.whatsapp.accessToken   ← obvious
 *   config.WHATSAPP_ACCESS_TOKEN  ← looks like raw env, easy to confuse
 */
const config = {

  // ── Server ─────────────────────────────────────────────────────────────────
  port:    env.PORT,
  nodeEnv: env.NODE_ENV,
  isDev:   env.NODE_ENV === 'development',
  isProd:  env.NODE_ENV === 'production',

  // ── WhatsApp ───────────────────────────────────────────────────────────────
  whatsapp: {
    accessToken:   env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken:   env.WHATSAPP_VERIFY_TOKEN,
    apiVersion:    env.WHATSAPP_API_VERSION,

    /** Fully constructed base URL for the WhatsApp Cloud API */
    apiBaseUrl: `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}`,
  },

  // ── Google ─────────────────────────────────────────────────────────────────
  google: {
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey:          env.GOOGLE_PRIVATE_KEY,   // \n already replaced above
    calendarId:          env.GOOGLE_CALENDAR_ID,
  },

  // ── Driver / Business Rules ────────────────────────────────────────────────
  driver: {
    timezone:       env.DRIVER_TIMEZONE,
    workStart:      env.DRIVER_WORK_START,   // "08:00"
    workEnd:        env.DRIVER_WORK_END,     // "20:00"
    minSlotMinutes: env.DRIVER_MIN_SLOT_MINUTES,
  },
};

export default config;