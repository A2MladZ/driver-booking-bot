import { z } from 'zod';

const envSchema = z.object({

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

  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info'),

  LOG_RETENTION_DAYS: z
    .string()
    .default('90')
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v >= 1 && v <= 365, {
      message: 'LOG_RETENTION_DAYS must be between 1 and 365',
    }),

  GOOGLE_CHAT_PROJECT_NUMBER: z
    .string()
    .min(1, 'GOOGLE_CHAT_PROJECT_NUMBER is required'),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z
    .string()
    .email('GOOGLE_SERVICE_ACCOUNT_EMAIL must be a valid email address'),

  GOOGLE_PRIVATE_KEY: z
    .string()
    .min(100, 'GOOGLE_PRIVATE_KEY appears too short — paste the full RSA key')
    .transform((key) => key.replace(/\\n/g, '\n')),

  GOOGLE_CALENDAR_ID: z
    .string()
    .min(1, 'GOOGLE_CALENDAR_ID is required'),

  DRIVER_TIMEZONE: z
    .string()
    .default('Asia/Kolkata')
    .refine(
      (tz) => {
        try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; }
        catch { return false; }
      },
      { message: 'DRIVER_TIMEZONE must be a valid IANA timezone' }
    ),

  DRIVER_WORK_START: z
    .string()
    .default('08:00')
    .refine((t) => /^\d{2}:\d{2}$/.test(t), {
      message: 'DRIVER_WORK_START must be in HH:mm format',
    }),

  DRIVER_WORK_END: z
    .string()
    .default('20:00')
    .refine((t) => /^\d{2}:\d{2}$/.test(t), {
      message: 'DRIVER_WORK_END must be in HH:mm format',
    }),

  DRIVER_MIN_SLOT_MINUTES: z
    .string()
    .default('60')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 15 && val <= 480, {
      message: 'DRIVER_MIN_SLOT_MINUTES must be between 15 and 480',
    }),

  // ── SQL Server ───────────────────────────────────────────────────────────────
  SQL_SERVER: z.string().min(1, 'SQL_SERVER is required'),
  SQL_DATABASE: z.string().min(1, 'SQL_DATABASE is required'),
  SQL_USER: z.string().min(1, 'SQL_USER is required'),
  SQL_PASSWORD: z.string().min(1, 'SQL_PASSWORD is required'),
  SQL_PORT: z.string().default('1433'),
  SQL_ENCRYPT: z.string().default('false'),
  SQL_TRUST_CERT: z.string().default('true'),
});

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

const config = {
  port:    env.PORT,
  nodeEnv: env.NODE_ENV,
  isDev:   env.NODE_ENV === 'development',
  isProd:  env.NODE_ENV === 'production',

  logging: {
    level:         env.LOG_LEVEL,
    retentionDays: env.LOG_RETENTION_DAYS,
  },

  googleChat: {
    projectNumber: env.GOOGLE_CHAT_PROJECT_NUMBER,
  },

  google: {
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey:          env.GOOGLE_PRIVATE_KEY,
    calendarId:          env.GOOGLE_CALENDAR_ID,
  },

  driver: {
    timezone:       env.DRIVER_TIMEZONE,
    workStart:      env.DRIVER_WORK_START,
    workEnd:        env.DRIVER_WORK_END,
    minSlotMinutes: env.DRIVER_MIN_SLOT_MINUTES,
  },

  sql: {
    server:   env.SQL_SERVER,
    database: env.SQL_DATABASE,
    user:     env.SQL_USER,
    password: env.SQL_PASSWORD,
    port:     parseInt(env.SQL_PORT, 10),
    encrypt:  env.SQL_ENCRYPT !== 'false',
    trustCert: env.SQL_TRUST_CERT === 'true',
  },
};

export default config;