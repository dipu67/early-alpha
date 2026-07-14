# early-alpha admin UI

Next.js (App Router) operator console for the early-alpha system. It is a
**backend-for-frontend**: the browser only talks to this Next.js app, which
holds the backend API key server-side and proxies every call to the API.
Login uses backend AdminUser (email/password); the API key never reaches the browser.

## Architecture

```
browser ──(login cookie)──> Next.js (admin) ──(x-api-key)──> backend API ──> Postgres / Redis / BullMQ
```

- `POST /api/login` — verifies email/password via backend, sets a signed httpOnly cookie.
- `app/dashboard/*` — server components read the backend via `lib/api.ts`.
- `/api/proxy/<backend-path>` — session-gated passthrough for client actions
  (track-now, reconcile, reclassify, delete, add/deactivate).
- `lib/session.ts` — stateless HMAC-signed cookie (no DB, 12h expiry).

## Setup

```bash
cd admin
npm install
cp .env.example .env          # or .env.local — fill in the three values
npm run dev                   # http://localhost:3000
```

`.env` / `.env.local`:

```
BACKEND_URL=http://localhost:4000
BACKEND_API_KEY=<same as backend ADMIN_API_KEY>
SESSION_SECRET=<a long random string>
```

Login uses backend AdminUser (email/password). Start the API first, then this UI.

## Pages

- **Signals** — feed of mint/launch/TGE posts, filter by tag slug + time window.
- **Projects & Tags** — detected accounts + tags; inline re-tag (reclassify).
- **Lists** — project lists + member counts; reconcile-now and delete-all actions.
- **Watchlist** — watched accounts; add, track-now, deactivate.
- **Auth Pool** — credential pool (tokens masked); add, activate/deactivate.

## Notes

- The two enqueue actions **reclassify** and **delete lists** rely on the backend
  jobs of the same name, which still need worker handlers in early-alpha (see
  `backend/README.md`). Until then the API enqueues them and they wait in Redis.
- Next.js 16: `cookies()` and route params are async; there is no middleware —
  the `/dashboard` layout is the auth gate.

## Deploy (VPS)

```bash
npm run build
pm2 start "npm run start" --name ea-admin   # or next start behind your proxy
```

Serve over HTTPS; set `NODE_ENV=production` so the session cookie is `secure`.
