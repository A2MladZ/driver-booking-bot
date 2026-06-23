/**
 * config/googleCalendar.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Initialises and exports a pre-authenticated Google Calendar API client.
 *
 * Authentication strategy — Service Account (server-to-server):
 *   Unlike OAuth 2.0 (which requires a browser login flow and refresh tokens),
 *   a Service Account authenticates directly using a private RSA key. This is
 *   the correct approach for backend bots that run without user interaction.
 *
 * How it works:
 *   1. GoogleAuth reads the service account credentials from config.
 *   2. It mints a short-lived JWT, exchanges it for an access token, and
 *      handles token refresh automatically before expiry.
 *   3. The `calendar` client is bound to that auth and is ready to make
 *      authenticated API calls immediately.
 *
 * Pre-requisites (in Google Cloud Console):
 *   - "Google Calendar API" must be enabled for the project.
 *   - The service account email must be shared on the target Google Calendar
 *     with at minimum "Make changes to events" permission.
 *
 * Usage:
 *   import { calendar, calendarId } from './config/googleCalendar.js';
 *   const res = await calendar.events.list({ calendarId, ... });
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { google } from 'googleapis';
import config from './env.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Build the GoogleAuth client
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GoogleAuth handles:
 *   - JWT creation from the service account credentials
 *   - Automatic token refresh (Google access tokens expire every 60 minutes)
 *   - Scoping — we request only the Calendar scope (principle of least privilege)
 *
 * Scopes reference:
 *   https://developers.google.com/calendar/api/guides/auth
 *
 *   calendar          → Full read/write access (needed to create & delete events)
 *   calendar.readonly → Read-only (not sufficient — we need to create/delete)
 */
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: config.google.serviceAccountEmail,
    private_key:  config.google.privateKey,        // \n already decoded in env.js
  },
  scopes: [
    'https://www.googleapis.com/auth/calendar',
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Create the Calendar API client bound to the auth instance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `google.calendar()` returns a versioned Calendar API client.
 * We use 'v3' — the current stable version.
 *
 * This is a singleton: the same instance is reused across all imports.
 * Node's module cache ensures `googleCalendar.js` is only executed once,
 * so auth and calendar are created exactly one time per process lifetime.
 */
const calendar = google.calendar({ version: 'v3', auth });

// ─────────────────────────────────────────────────────────────────────────────
// 3. Connectivity test helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performs a lightweight API call to verify that:
 *   - The credentials are valid
 *   - The service account has access to the target calendar
 *   - The network can reach Google's APIs
 *
 * Called once at server startup (from server.js optionally) so misconfigured
 * credentials surface immediately rather than on the first booking attempt.
 *
 * @returns {Promise<boolean>} true if connection is healthy
 * @throws  {Error}           with a descriptive message if it fails
 */
const verifyCalendarConnection = async () => {
  try {
    const res = await calendar.calendarList.get({
      calendarId: config.google.calendarId,
    });

    console.log(
      `[googleCalendar] ✅ Connected to calendar: "${res.data.summary}" (${config.google.calendarId})`
    );
    return true;
  } catch (err) {
    // Surface actionable error messages for common failure modes
    const status = err?.response?.status;
    const reason = err?.response?.data?.error?.message || err.message;

    if (status === 401) {
      throw new Error(
        '[googleCalendar] ❌ Authentication failed (401). ' +
        'Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in your .env file.'
      );
    }

    if (status === 403) {
      throw new Error(
        '[googleCalendar] ❌ Permission denied (403). ' +
        `Share the calendar "${config.google.calendarId}" with ` +
        `"${config.google.serviceAccountEmail}" and grant "Make changes to events" access.`
      );
    }

    if (status === 404) {
      throw new Error(
        `[googleCalendar] ❌ Calendar not found (404). ` +
        `Verify GOOGLE_CALENDAR_ID="${config.google.calendarId}" is correct.`
      );
    }

    throw new Error(`[googleCalendar] ❌ Calendar connection failed: ${reason}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  calendar,                  // Authenticated Calendar API client
  auth,                      // Auth instance (used by FreeBusy calls too)
  verifyCalendarConnection,  // Startup health-check helper
};

// Also export calendarId as a convenience — avoids importing config everywhere
export const calendarId = config.google.calendarId;