# Early Alpha

Twitter following tracker for crypto influencers and early project hunters. Monitors who key accounts start following, detects convergence signals (multiple seeds following the same new account), and sends alerts via Telegram.

## Architecture

- **Twitter Client** — fetches following lists for seed accounts
- **BullMQ Workers** — background jobs for tracking, diffing, and digest generation
- **Telegram Bot** — delivers real-time alerts and daily digests (Grammy)
- **PostgreSQL** — stores seed accounts, follow edges, and alert history (Prisma)
- **Redis** — job queue backend (BullMQ)

## Setup

### Prerequisites

- Node.js 20+
- Docker (for Postgres and Redis)

### Install

```sh
cp .env.example .env   # fill in your credentials
docker compose up -d
npm run install:all    # root API + admin UI deps
npx prisma migrate deploy
```

### Environment Variables

Copy `.env.example` → `.env`. **Only these are required:**

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ADMIN_API_KEY` | Shared secret for admin API / UI proxy |

Configure in **admin UI / DB** (not env): Telegram bots, alert chat & topics, admin user ids (`tg.adminIds`), Grok bot, Twitter auth pool, list owners.

Admin UI env: see `admin/.env.example` (`BACKEND_URL`, `BACKEND_API_KEY`, `SESSION_SECRET`).

## Usage

### Build & start (API + admin)

```sh
# On a fresh VPS / clone — install BOTH root and admin deps first
npm run install:all

# One-shot: compile API (tsc) + admin (Next.js)
# build:admin also runs npm install --prefix admin if needed
npm run build          # same as build:all
npm run build:api      # API only → dist/
npm run build:admin    # admin only (installs admin deps then next build)

# Production: run both together (API :4000, admin :3000 by default)
npm start              # same as start:all
npm run start:api      # API only
npm run start:admin    # admin only
```

If you see `next: not found`, admin deps are missing:

```sh
npm install --prefix admin
# or
npm run install:all
npm run build
```

### Dev (hot reload)

```sh
npm run dev:all        # API + admin together
npm run dev:api        # API only (tsx)
npm run dev:admin      # admin only (next dev)

# Or run components individually
npm run bot            # Telegram bot only
npm run worker         # BullMQ worker only
```

### Tracking CLI

```sh
npm run track:init-db        # Initialize tracking database
npm run track:import-seeds   # Import seed accounts
npm run track:run            # Run incremental tracking pass
npm run track:run-full       # Full sync of all seeds
npm run track:digest         # Generate and send daily digest
npm run track:health         # Health check
```

## Testing

```sh
npm test
```
