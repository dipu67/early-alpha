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
npm install
npx prisma migrate dev
```

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `TELEGRAM_BOT_TOKEN` | Grammy bot token |
| Twitter credentials | API keys for fetching following data |

## Usage

```sh
# Start everything (bot + workers + scheduler)
npm run dev

# Or run components individually
npm run bot        # Telegram bot only
npm run worker     # BullMQ worker only
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
