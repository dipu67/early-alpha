# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Commands

```sh
npm run install:all      # root API deps + admin/ deps (admin is a separate npm project)
npm run dev:all          # API (tsx, :4000) + admin (next dev, :3000)
npm run dev:api          # API only
npm run typecheck        # tsc --noEmit  — run this, there is no lint step
npm test                 # vitest run (no vitest config; picks up src/tests/*.test.ts)
npm run build            # tsc → dist/ + next build in admin/
npm start                # node dist/index.js + next start
```

Single test / filtered test:

```sh
npx vitest run src/tests/track.test.ts
npx vitest run -t "convergence"
npx vitest                                # watch mode
```

Infra + migrations (Prisma schema is **not** in the default location):

```sh
docker compose up -d postgres redis                          # infra only
npx prisma migrate deploy                                    # prisma.config.ts supplies schema+url
npx prisma generate                                          # → src/generated/prisma (tracked TS source)
npm run docker:migrate                                       # same, inside the api container
```

`prisma.config.ts` points the CLI at `src/prisma/schema.prisma` and `src/prisma/migrations`, and supplies
`datasource.url` from `DATABASE_URL` — the schema's datasource block has no `url`. If you invoke Prisma in a
context that ignores the config file, pass `--schema src/prisma/schema.prisma` explicitly. There are no
`prisma:*` npm scripts; call the CLI directly.

CLI tools worth knowing (full list in `package.json`): `npm run user:create` (first `AdminUser` — required to
log into the admin UI), `npm run track:run` / `track:run-full`, `npm run tag:backfill`, `npm run db:export` /
`db:import`.

Scripts under `src/Tools/following_Track/` run with **bun**, not tsx. Everything else uses tsx.

Required env at process start is only `DATABASE_URL`, `REDIS_URL`, `ADMIN_API_KEY` (+ optional `PORT`).
Everything else — Telegram bot tokens, alert routing, Twitter credentials, signal rules, scheduler
intervals — lives in the DB and is edited through the admin UI. Don't add env vars for runtime-tunable
config; add a `Setting` key instead.

## Architecture

Two deployables, one database, one Redis:

```
browser ──session cookie──> Next.js admin (:3000) ──x-api-key──> Express API (:4000)
                                                                       │
                                        ┌──────────────────────────────┼───────────────┐
                                   PostgreSQL                    Redis/BullMQ      Telegram
                                    (Prisma)                    2 queues + sched    (Grammy)
```

**The API process is also the worker host.** `index.ts` side-effect-imports `seedWorker.ts` and
`listWorker.ts`, starts both Telegram bots, registers all schedulers, and runs digest catch-up. There is no
separate worker deployment in normal operation. Bot startup failures are logged and swallowed so the API
still serves.

### Queues, jobs, schedulers

Two BullMQ queues only: `seed-tracker` and `list-tracker`. Adding background work means touching three
places that must agree on `(queueName, jobName, payload)`:

1. `src/jobs.ts` — the job contract. Each entry declares queue, BullMQ job name, a zod payload schema, and
   an `existing` flag (whether a handler is live). This is the sole coupling point; `src/enqueue.ts` validates
   against it before pushing.
2. `src/services/seedWorker.ts` / `listWorker.ts` — the `switch` on job name. **Every branch uses a lazy
   `await import()`** of its service module rather than a top-level import. Follow that: it keeps worker boot
   cheap and avoids import cycles between services.
3. `src/services/queue.ts` `SCHEDULERS[]` — if the job repeats. This registry is the single source of truth
   for recurring work (key, schedulerId, jobName, data, `defaultEvery` or `defaultCron`).

Scheduler cadence is overridable at runtime via `Setting` keys `sched.<key>.every|cron|paused`; cron wins
over `every`, and `every` below 10s is ignored. Retiring a scheduler requires adding it to
`REMOVED_SCHEDULERS[]` so the stale repeatable is stripped from Redis on next boot — otherwise it runs
forever. Note that `reconcile-lists` / `poll-lists` handlers still exist but their schedulers are retired, so
they are manual-only.

Two queue modules exist by design: `src/services/queue.ts` (worker side — owns Workers and schedulers) and
`src/queue.ts` (API side — lazily builds `Queue` handles only, never runs a Worker, never touches Twitter
in-process). Same Redis, same queue names.

### Twitter access

`src/twitter/getClient.ts` is the canonical entry point (~57 call sites). `TwitterClient` is stateless
per-call — a fresh instance is built from a `TwitterAuthAccount` row's cookies on every acquisition. Three
selection strategies, and the difference matters:

- `getTwitterClient()` — least-recently-used rotation over active, non-rate-limited accounts.
- `getTwitterClientById(id?)` — pins one account (e.g. per search query); rotates if null.
- `getListClient(authAccountId?)` — **deterministic**, lowest-id active account. X only lets a list's owner
  mutate members, so list operations must run as the owning credential (`ProjectList.authAccountId`).

**Rate-limit marking is the caller's job, not the client's.** Results carry an optional `rateLimit` parsed
from `x-rate-limit-*` headers; callers must check it and call `markRateLimited(accountId, reset)` themselves.
`markAuthInvalid` deliberately soft-pauses for 2h via `rateLimitedUntil` instead of setting
`isActive=false`, because hard deactivation fought the admin UI's Activate button and drained the pool.
`isTwitterAuthError()` matches only X code 32 — never a bare HTTP 401, since Cloudflare and transaction-id
failures also 401 without the cookie being dead.

`TwitterClient.ts` impersonates the **web client**, not the public API: hardcoded web bearer token, Chrome
header set, and a per-request `x-client-transaction-id` minted from a scraped x.com HTML shell (cached 1h,
falls back to a random id after retries so jobs degrade instead of crashing). Two hosts are used —
`x.com/i/api/graphql` and `api.x.com/graphql` — and the transaction-id path string **must** match the host
style or X returns a Cloudflare HTML block. Some operations (`UsersByRestIds`) are CF-blocked on the primary
host and need `preferApiX`. When X rotates query IDs, update `src/TwitterClient/query-ids.json`; it overrides
the in-code `FALLBACK_QUERY_IDS` with no code change.

`src/fxTwitter/` is an unauthenticated client for the public FxTwitter API. The split is **per-operation, not
fallback**: authenticated `TwitterClient` does batched profile lookups, FxTwitter does all timeline fetching
in `earlyProjectPoller.ts`, specifically to avoid burning the scarce `getUserTweets` budget (~50/15m).
FxTwitter pagination is cursor-based via `TwitterAccount.fxCursor` (`cursor.top`), and first sight of an
account seeds the cursor while emitting no alerts.

### Config

`src/services/appConfig.ts` wraps the `Setting` table (key → JSON) with a ~5s in-process cache, so admin
edits reach the running worker without a restart. `getConfig<T>(key, fallback)` never throws — DB errors,
missing rows, and bad JSON all return the fallback. The convention is env/hardcoded as *fallback*, DB as
*override*. Keys are dotted namespaces: static ones belong in `CONFIG_KEYS`; per-entity ones come from
helpers (`alertEnabledKey`/`alertBotKey`/`alertTopicKey`, `schedEveryKey`/`schedCronKey`/`schedPausedKey`).
The table also doubles as a last-run scratchpad (`earlyPoll.lastResult`, `digest.*.lastSentAt`).

### Seed tracking

`src/Tools/following_Track/track.ts` is both a library and a CLI (guarded by an `argv[1]` check). `seedWorker`
is a 33-line shim that dynamically imports it and calls `runTrackingCycle`, `sendDailyDigestMessage`, or
`checkHealth` — CLI and worker are two front doors on one implementation, not duplicated logic.

Core algorithm: `fullSync` differs from incremental only in page depth (5000 vs 20 follows). Per followed
user, upsert `TwitterAccount` and look up the `FollowEdge` composite key; new edges fire a `newFollow` alert.
**Convergence = ≥2 distinct seeds following the same target within a rolling 72h window**, scored by that
count, deduped by updating an existing `convergence` alert in place if one exists within 24h. A seed's very
first run suppresses convergence checks (`isFirstRunForSeed`) since every edge would look new. Unfollow
detection (`markUnfollowedEdges`) only runs on full sync.

Note two coexisting classification systems: hardcoded `CATEGORY_KEYWORDS`/`EXCHANGE_NAMES` in `track.ts` for
alert categories, and the DB-backed `classifyAccount` tagger driven by `project_tags`.

### Admin UI (`admin/`)

Next 16 App Router, React 19, Tailwind v4, Radix + CVA components. Path alias `@/*` → `admin/*`.

The admin is a BFF and the **only** place RBAC exists. The backend checks `x-api-key` and nothing else —
there is no per-role auth server-side. `admin/lib/rbac.ts` `requiredRoleFor(method, backendPath)` is a
path-prefix table enforced solely in the proxy: all GETs are viewer; `/api/backup/*` is admin even for GET;
`/api/users`, `/api/settings`, `/api/queues`, `/api/tg`, `/api/lists/delete` are admin; every other write is
editor. **Adding a backend route under a new prefix silently defaults to editor-for-writes** — update
`requiredRoleFor` if it needs to be stricter. UI role gating (`useCan`, `minRole` in `admin/lib/nav.ts`) is
cosmetic only.

Sessions are stateless HMAC-signed cookies (`ea_admin_session`, 12h, `SESSION_SECRET`) — no server-side store
and **no revocation**. Login delegates credential checking to the backend `POST /api/auth/login`. The auth
gate is `app/dashboard/layout.tsx`, not middleware; anything outside `/dashboard` is ungated.

Two API helpers, and picking the wrong one leaks the API key to the browser:
- Server Components / route handlers → `backendFetch` from `@/lib/api` (server-only; attaches `x-api-key`).
- Client components → `proxy()` from `@/lib/client`, or the `useFetch<T>` hook.

Adding an admin page follows a uniform pattern: an `async` Server Component `page.tsx` with
`export const dynamic = "force-dynamic"` that `backendFetch`es initial data and renders a sibling
`"use client"` panel, plus a `NAV` entry. **Do not add files under `app/api/`** — the catch-all
`app/api/proxy/[...path]/route.ts` is the only API route needed. Relatedly, `admin/next.config.ts` carries a
load-bearing warning: never add an `/api/*` rewrite to Express, because `afterFiles` rewrites beat dynamic
routes and would shadow the proxy into 401s.

Watch out: the backend uses **zod v4**, admin uses **zod v3**. Don't copy schemas across the boundary.

### Prisma specifics

Prisma 7 with the new `prisma-client` generator (not `prisma-client-js`) and the `@prisma/adapter-pg` driver
adapter — no Rust engine. Generated output at `src/generated/prisma` is a real TS source tree imported with
`.js` ESM specifiers. 31 models, all `@@map`'d to snake_case with snake_case `@map` fields and
`@db.Timestamptz` timestamps. IDs are `BigInt` autoincrement except Twitter-derived ones, which are String
snowflakes.

`src/db/prisma.ts` is the canonical client export (~54 importers, re-exported from `index.ts`). It also owns
`resyncSerialSequence` / `resyncAllSerialSequences`, which `setval` the BIGSERIAL sequences after a
backup/import — needed because import writes explicit ids and leaves sequences behind `MAX(id)`, causing
unique-constraint errors on the next create. `track.ts` wraps its `TrackingRun` create in a retry that calls
this.

Central models: `TwitterAccount` is the hub (String snowflake id, carries the hunter funnel `huntStage` and
poller watermarks `lastProfilePolledAt`/`fxCursor`), fanning out to `FollowEdge`, `Alert`, `ListMember`,
`AccountMetricSnapshot`. `SeedAccount` → `FollowEdge` (composite PK `[seedId, followingId]`, with
`firstSeenRunId`/`lastSeenRunId` → `TrackingRun` and an `active` flag) is the follow graph. Many clusters are
standalone with no FK into that core: `SignalScan`/`SignalRule`, `SearchQuery`/`SearchHit`,
`ListMonitor`, `Grok*`, `Telegram*`, `GithubRepoMonitor`, `AdminUser`, `Setting`.

Codebase conventions: strict TS with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, ESM with
`verbatimModuleSyntax` (so relative imports end in `.js`). Route handlers can `throw` — Express 5 forwards
rejections to `errorMiddleware`, which maps `ZodError` → 400 and `HttpError` → its status.

## Known stale state

Verify before trusting; fix opportunistically rather than working around:

- **`npm run typecheck` currently fails with one error**: `src/appConfig.ts` imports the deleted
  `src/prisma.js`. That file is a dead uncached duplicate of `src/services/appConfig.ts` with zero importers
  and should be deleted.
- `src/db/db.ts` and `src/prisma.ts` are deleted in the working tree but not committed. Nothing references
  them; `src/db/prisma.ts` is canonical.
- `README.md` documents a `worker.ts` and an `npm run worker` script. Neither exists — follow-tracking runs
  inside `seedWorker` via the `track-seeds` job.
- `npm run track:init-db` is a no-op; `init-db` was never implemented in `track.ts` (leftover from the
  pre-Prisma raw-SQL era).
- `src/TwitterClient/TwitterProxyClient.ts` and `src/twitter/getProxyClient.ts` are empty placeholders,
  unreferenced and unexported.
- `src/tests/dbTest.ts`, `fxTwitter.ts`, `usersByRestIds.ts` are scratch scripts, not vitest tests.
  `src/tests/**` is excluded from `tsconfig.json`, so `typecheck` does not cover them.
