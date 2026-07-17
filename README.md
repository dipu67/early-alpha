# Early Alpha

Crypto early-signal desk: track who influencers start following, detect project launches and TGEs, watch Twitter lists/searches/timelines, surface new chains and GitHub activity, and alert operators on Telegram.

An Express admin API + BullMQ workers + Telegram bots form the backend. A Next.js operator console (`admin/`) proxies to the API with session-based login.

## What it does

| Area | Description |
|---|---|
| **Seed following** | Poll seed accounts’ following graphs; detect new follows and multi-seed convergence |
| **Hunter** | Hot board / heat scores fusing seed follows, watchers, search hits, and account age |
| **Signals** | Rule-based mint / launch / TGE detection from HomeLatest timelines (per tag) |
| **User monitors** | Poll project timelines for new posts matching rules |
| **Live search** | Scheduled Twitter search queries → hits + alerts |
| **List monitors** | Track public Twitter lists for new members |
| **Project lists & tags** | Auto-tag early projects from bios/handles; maintain tag-scoped Twitter lists |
| **New chains** | Diff Chainlist `rpcs.json` + DefiLlama GitHub registry for new chain IDs |
| **GitHub repos** | Poll watched repos for new commits |
| **Grok research** | Telegram Grok bot + stored research prompts/runs |
| **Digests** | Daily seed digest + early-project digest (09:00 & 21:00 UTC) |
| **Admin UI** | Full operator console (RBAC: admin / editor / viewer) |

## Architecture

```
browser ──(session cookie)──> Next.js admin (:3000)
                                    │ x-api-key
                                    ▼
                              Express API (:4000)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
         PostgreSQL              Redis/BullMQ         Telegram
         (Prisma)                (3 queues)           (Grammy)
                                      │
                         workers + schedulers
                         (follow / seed / list)
```

| Component | Role |
|---|---|
| **TwitterClient** | GraphQL client over auth-pool accounts (cookies / tokens) |
| **BullMQ queues** | `follow-tracker`, `seed-tracker`, `list-tracker` |
| **Workers** | `worker.ts`, `seedWorker.ts`, `listWorker.ts` (started with the API process) |
| **Telegram** | Main alert bot + Grok bot (tokens from DB) |
| **PostgreSQL** | Seeds, edges, projects, signals, settings, auth pool, … |
| **Redis** | Job queue + repeatable schedulers |
| **Admin UI** | BFF: login cookie; never exposes `ADMIN_API_KEY` to the browser |

### Default schedulers

| Key | Cadence | Job |
|---|---|---|
| seed-track | every 15m | Incremental seed following |
| seed-full-sync | daily 03:00 UTC | Full seed sync |
| daily-digest | daily 09:00 UTC | Seed digest |
| health-check | every 6h | Health |
| early-digest | 09:00 & 21:00 UTC | Early-project digest |
| search-poll | every 1m | Search queries |
| list-monitor-poll | every 1m | Public list monitors |
| chainlist-poll | every 1h | New chains |
| github-repo-poll | every 5m | Repo commits |
| monitor-poll | every 2m | User timeline monitors |
| home-signal-poll | every 2m | HomeLatest signal scans |

Intervals are defaults; many can be adjusted via settings / queues UI.

## Repo layout

```
early-alpha/
├── index.ts              # API entry: workers, bots, schedulers, listen
├── src/
│   ├── server.ts         # Express app + routes
│   ├── jobs.ts           # Job contracts (queue + name + zod payload)
│   ├── schedulers.ts     # Scheduler registry
│   ├── routes/           # Admin API routes
│   ├── services/         # Workers, pollers, digests, hunter, …
│   ├── TwitterClient/    # Low-level X client
│   ├── tg/               # Telegram bots + alerts
│   ├── prisma/           # schema + migrations
│   └── Tools/            # CLI utilities (track, tags, backup, …)
├── admin/                # Next.js operator UI
├── data/                 # Chainlist snapshots, etc.
└── docker-compose.yml    # Postgres + Redis
```

## Setup

### Prerequisites

- Node.js 20+
- Docker (Postgres + Redis)
- Bun optional (used by some CLI scripts: `bot`, `worker`, `track:*`)

### Install

```sh
cp .env.example .env          # fill in required vars
cp admin/.env.example admin/.env
docker compose up -d
npm run install:all           # root API + admin UI
npx prisma migrate deploy
npm run user:create           # create first AdminUser (email/password)
```

### Environment

**Backend** (`.env`) — only these are required at process start:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `ADMIN_API_KEY` | Shared secret for API + admin proxy (`x-api-key` / Bearer) |
| `PORT` | Optional; default `4000` |

Everything else lives in the DB / admin UI: Telegram bots, alert chats & topics, `tg.adminIds`, Grok bot, Twitter auth pool, list owners, signal rules, search queries, etc.

**Admin UI** (`admin/.env` or `admin/.env.local`):

| Variable | Description |
|---|---|
| `BACKEND_URL` | API base URL (e.g. `http://localhost:4000`) |
| `BACKEND_API_KEY` | Must match backend `ADMIN_API_KEY` |
| `SESSION_SECRET` | Long random string for cookie signing |

## Usage

### Build & start (API + admin)

```sh
npm run install:all

npm run build          # tsc API → dist/ + next build admin
npm run build:api
npm run build:admin

npm start              # API :4000 + admin :3000
npm run start:api
npm run start:admin
```

`npm start` / `dev:all` run **API + admin together**. The API process also starts workers, Telegram bots, and schedulers.

If you see `next: not found`, install admin deps:

```sh
npm install --prefix admin
# or
npm run install:all
```

### Dev (hot reload)

```sh
npm run dev:all         # API (tsx) + admin (next dev)
npm run dev:api
npm run dev:admin

# Standalone process scripts (Bun)
npm run bot            # Telegram bot only
npm run worker         # follow-tracker worker only
npm run seed-worker    # seed-tracker worker only
```

### Tracking CLI

```sh
npm run track:init-db
npm run track:import-seeds
npm run track:run            # incremental pass
npm run track:run-full       # full sync
npm run track:digest
npm run track:health
```

### Other tools

```sh
npm run user:create          # AdminUser
npm run tag:backfill         # retag projects
npm run list:sync            # sync project lists to Twitter
npm run list:delete
npm run tag:seed-keywords
npm run grok:store-prompts
npm run db:summary           # backup helpers
npm run db:export
npm run db:import
npm run typecheck
```

## Admin UI

Open `http://localhost:3000` after both processes are up. Login with an `AdminUser`.

| Section | Purpose |
|---|---|
| Overview | High-level metrics |
| Hunter | Convergence heat / hunt stages |
| User Monitor | Per-account timeline monitors |
| Signals | Mint/launch/TGE feed + scan config |
| Live Search | Search queries & hits |
| List Monitors | Public Twitter list membership |
| New Chains | Chainlist / registry diffs |
| GitHub Repos | Repo commit monitors |
| Projects & Tags | Detected accounts, reclassify |
| Keywords | Tag keyword / handle rules |
| Lists | Project list membership |
| Watchlist | Per-account follow watch |
| Auth Pool | Twitter credential pool |
| Queues | BullMQ / scheduler controls (admin) |
| Telegram | Bots, groups, topics (admin) |
| Grok | Research prompts & runs (editor+) |
| Backup | DB export/import (admin) |
| Settings | App config (admin) |

API surface mirrors these under `/api/*` (API key required except `GET /health`).

## Testing

```sh
npm test                 # vitest
npm run typecheck
```

## Health

```sh
curl -s http://localhost:4000/health
# {"ok":true,"service":"early-alpha-admin-api"}
```
