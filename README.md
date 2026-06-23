# 🚗 Driver Booking Bot

A production-ready WhatsApp booking bot that lets customers check driver
availability, make bookings, cancel reservations, and view their upcoming
trips — all through WhatsApp messages. Powered by Node.js, Express,
WhatsApp Cloud API, and Google Calendar.

---

## 📁 Project Structure

```
driver-booking-bot/
│
├── server.js                        # Express app entry point, graceful shutdown
├── package.json                     # Dependencies and scripts
├── .env.example                     # Environment variable reference (copy to .env)
│
├── config/
│   ├── env.js                       # Zod-validated, structured config — single source of truth
│   └── googleCalendar.js            # Authenticated Google Calendar API client (singleton)
│
├── routes/
│   ├── webhook.routes.js            # GET + POST /api/v1/webhook
│   ├── booking.routes.js            # CRUD /api/v1/bookings (admin REST)
│   └── health.routes.js             # GET /health
│
├── controllers/
│   ├── webhookController.js         # Webhook verification + message dispatcher
│   └── bookingController.js         # Admin booking REST handlers
│
├── services/
│   ├── calendarService.js           # Google Calendar: FreeBusy, create, cancel, list
│   └── whatsappService.js           # WhatsApp Cloud API: send messages, format replies
│
├── middleware/
│   ├── errorHandler.js              # Global Express error handler (4-arg)
│   ├── notFoundHandler.js           # 404 catch-all
│   └── requestLogger.js             # Per-request structured logging + X-Request-Id
│
├── models/
│   └── booking.model.js             # Booking schema, factory, lifecycle helpers
│
└── utils/
    ├── dateParser.js                # Natural language date/time parser (chrono-node + dayjs)
    ├── messageParser.js             # WhatsApp command intent parser
    └── logger.js                    # Structured logger (JSON in prod, coloured in dev)
```

---

## ⚙️ Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 18.0.0 | Uses native `--watch`, `fetch`, `crypto.randomUUID` |
| Google Cloud Project | — | With Calendar API enabled |
| Google Service Account | — | With Calendar share permission |
| Meta Developer Account | — | With a WhatsApp Business App |
| A public HTTPS URL | — | For the webhook (use ngrok in dev) |

---

## 🚀 Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/driver-booking-bot.git
cd driver-booking-bot
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in every value (see [Environment Variables](#-environment-variables) below).

### 3. Start the server

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

### 4. Expose locally with ngrok (development)

```bash
ngrok http 3000
```

Copy the `https://xxxx.ngrok.io` URL — you'll need it for the Meta webhook setup.

### 5. Verify the server is running

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "uptime": { "seconds": 12, "human": "0h 0m 12s" },
  "environment": "development",
  "services": { ... }
}
```

---

## 🔐 Environment Variables

Copy `.env.example` to `.env` and fill in each value:

```dotenv
# Server
PORT=3000
NODE_ENV=development

# WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=        # From Meta Developer Portal
WHATSAPP_PHONE_NUMBER_ID=     # From Meta Developer Portal
WHATSAPP_VERIFY_TOKEN=        # A secret string you choose (min 8 chars)
WHATSAPP_API_VERSION=v19.0

# Google Calendar
GOOGLE_SERVICE_ACCOUNT_EMAIL= # From service account JSON key
GOOGLE_PRIVATE_KEY=           # From service account JSON key (keep \n as-is)
GOOGLE_CALENDAR_ID=           # Driver's calendar ID (usually their Gmail)

# Driver / Business Rules
DRIVER_TIMEZONE=Asia/Kolkata
DRIVER_WORK_START=08:00
DRIVER_WORK_END=20:00
DRIVER_MIN_SLOT_MINUTES=60
```

---

## ☁️ Google Calendar Setup

### Step 1 — Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Enable the **Google Calendar API**:
   - APIs & Services → Library → Search "Google Calendar API" → Enable

### Step 2 — Create a Service Account

1. IAM & Admin → Service Accounts → **Create Service Account**
2. Give it a name (e.g. `driver-booking-bot`)
3. Skip optional role and user access steps
4. Click the service account → **Keys** tab → **Add Key** → JSON
5. Download the JSON key file

### Step 3 — Copy credentials to .env

From the downloaded JSON key file:
```
"client_email"  →  GOOGLE_SERVICE_ACCOUNT_EMAIL
"private_key"   →  GOOGLE_PRIVATE_KEY
```

⚠️ The private key contains literal `\n` characters. Keep them exactly as-is
when pasting into `.env`. Wrap the value in double quotes:
```
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nABC...\n-----END RSA PRIVATE KEY-----\n"
```

### Step 4 — Share the Calendar

1. Open [Google Calendar](https://calendar.google.com)
2. Find the driver's calendar → Settings → **Share with specific people**
3. Add the service account email
4. Permission: **Make changes to events**
5. Copy the **Calendar ID** (Settings → scroll down) → paste into `GOOGLE_CALENDAR_ID`

---

## 📱 WhatsApp Cloud API Setup

### Step 1 — Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. My Apps → **Create App** → Business → Next
3. Add product: **WhatsApp**

### Step 2 — Get your credentials

Under WhatsApp → API Setup:
- **Temporary access token** → `WHATSAPP_ACCESS_TOKEN` (valid 24h in dev)
- **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`

For production, create a **System User Token** under Business Settings → System Users.

### Step 3 — Register the webhook

Under WhatsApp → Configuration → Webhook:

| Field | Value |
|---|---|
| Callback URL | `https://your-domain.com/api/v1/webhook` |
| Verify Token | The value you set as `WHATSAPP_VERIFY_TOKEN` in `.env` |

Subscribe to the **messages** field.

### Step 4 — Test the verification

After saving, Meta sends a GET request to your webhook URL. Check your server
logs for:
```
[webhookController] ✅ Webhook verified successfully
```

---

## 💬 WhatsApp Commands

Send these messages to the bot's WhatsApp number:

### Check Availability
```
availability today
availability tomorrow
availability 10-Jul-2026
```

### Book a Slot
```
book today 8am-11am
book tomorrow 2pm-5pm
book 10-Jul-2026 09:00-13:00
```

### Cancel a Booking
```
cancel BK-3f2504e0
```

### View Your Bookings
```
my bookings
```

### Help Menu
```
help
```

---

## 🌐 Admin REST API

These endpoints are for admin dashboards and debugging (not WhatsApp).

### Health Check
```http
GET /health
```

### Check Availability
```http
POST /api/v1/bookings/availability
Content-Type: application/json

{ "date": "10-Jul-2026" }
```

### List Customer Bookings
```http
GET /api/v1/bookings?phone=919876543210
GET /api/v1/bookings?phone=919876543210&includePast=true
```

### Get Single Booking
```http
GET /api/v1/bookings/BK-3f2504e0
```

### Create Booking (Admin)
```http
POST /api/v1/bookings
Content-Type: application/json

{
  "startISO":      "2026-07-10T02:30:00.000Z",
  "endISO":        "2026-07-10T05:30:00.000Z",
  "customerPhone": "919876543210",
  "customerName":  "John Doe"
}
```

### Cancel Booking (Admin)
```http
DELETE /api/v1/bookings/BK-3f2504e0
```

---

## 🏗️ Architecture

```
WhatsApp User
     │
     │  Text message
     ▼
Meta Cloud API  ──POST──▶  /api/v1/webhook
                                │
                         HTTP 200 immediately  ◀── Meta retry prevention
                                │
                      webhookController.js
                                │
                       messageParser.js         ← Intent detection
                                │
                    ┌───────────┼───────────┐
                    │           │           │
             AVAILABILITY     BOOK       CANCEL / MY_BOOKINGS
                    │           │           │
              calendarService.js (FreeBusy / events.insert / events.delete)
                    │           │           │
              whatsappService.js (sendMessage via Cloud API)
                    │
              WhatsApp User receives reply
```

### Data Flow — Booking Creation

```
"book 10-Jul-2026 8am-11am"
         │
   parseMessage()          →  { intent: BOOK, args: { dateStr, timeRange } }
         │
   parseDate()             →  dayjs object (Asia/Kolkata)
   parseTimeRange()        →  { startHour: 8, endHour: 11 }
   buildDateTimeRange()    →  { startISO, endISO } + validation
         │
   isSlotAvailable()       →  FreeBusy API check
   calendar.events.insert  →  Google Calendar event created
         │
   generateBookingRef()    →  "BK-3f2504e0"
         │
   sendBookingConfirmation →  WhatsApp message sent
```

---

## 🔒 Security Notes

- **Never commit `.env`** — it's in `.gitignore` by default
- **Rotate tokens regularly** — the WhatsApp temporary token expires in 24h
- **Use a System User Token** in production (doesn't expire)
- **WHATSAPP_VERIFY_TOKEN** should be at least 32 random characters:
  ```bash
  openssl rand -hex 32
  ```
- **GOOGLE_PRIVATE_KEY** — never log or expose this value
- **Webhook ownership** — Meta verifies the token; no additional auth needed
  on the webhook endpoint itself (Meta's servers are the only caller)

---

## 🚢 Deployment

### Render

1. Connect your GitHub repo to [render.com](https://render.com)
2. New Web Service → select repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all `.env` values under **Environment**
6. Set your Render URL as the Meta webhook callback URL

### Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set PORT=3000 NODE_ENV=production ...
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t driver-booking-bot .
docker run -p 3000:3000 --env-file .env driver-booking-bot
```

---

## 🐛 Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| `GOOGLE_PRIVATE_KEY` auth error | Newlines not decoded | Wrap key in double quotes in `.env`, keep literal `\n` |
| 403 from Google Calendar | Service account not shared | Share calendar with service account email, grant "Make changes to events" |
| 404 from Google Calendar | Wrong `GOOGLE_CALENDAR_ID` | Check calendar Settings → Calendar ID |
| Meta webhook verification fails | Token mismatch | Ensure `WHATSAPP_VERIFY_TOKEN` in `.env` matches the Meta portal exactly |
| Bot not replying | Non-text message type | Bot only handles text — voice, images, etc. are ignored |
| Duplicate messages | Server returning non-200 | Check logs — server must always return 200 to Meta |
| Slot shown as available but booking fails | Race condition | Two users booked simultaneously — bot shows friendly error and asks to re-check |

---

## 📦 Dependencies

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.19 | HTTP server and routing |
| `axios` | ^1.7 | WhatsApp Cloud API HTTP client |
| `googleapis` | ^140 | Google Calendar API client |
| `dayjs` | ^1.11 | Date manipulation and timezone handling |
| `chrono-node` | ^2.7 | Natural language date parsing |
| `uuid` | ^10 | Booking reference ID generation |
| `zod` | ^3.23 | Runtime schema validation |
| `dotenv` | ^16 | `.env` file loading |
| `morgan` | ^1.10 | HTTP access logging |

---

## 📄 Licence

MIT — see [LICENSE](LICENSE)
