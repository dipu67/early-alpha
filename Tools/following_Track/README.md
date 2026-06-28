# Twitter Following Tracker

This tool tracks the accounts followed by crypto influencers and early project hunters, stores the data in Postgres, and raises alerts when the same discovered account is followed by multiple seeds.

## Environment

Required values:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
TWITTER_AUTH_TOKEN="your_auth_token_cookie"
TWITTER_CT0="your_ct0_cookie"
```

Optional values:

```env
TWITTER_USER_AGENT="browser user agent"
FOLLOWING_PAGE_SIZE=100
FOLLOWING_MAX_PAGES=5
FOLLOWING_REQUEST_DELAY_MS=1500
FOLLOWING_RETRY_COUNT=2
ALERT_MIN_SEEDS=2
```

The current client also accepts the legacy `authToken` and `ct0` environment names while migrating to `TWITTER_AUTH_TOKEN` and `TWITTER_CT0`.

## Commands

Run from the project root:

```bash
npm run track:init-db
npm run track:import-seeds
npm run track:run
npm run track:alerts
npm run track:top
```

Direct command form:

```bash
npx tsx Tools/following_Track/track.ts init-db
npx tsx Tools/following_Track/track.ts import-seeds
npx tsx Tools/following_Track/track.ts add-seed influencer cobie
npx tsx Tools/following_Track/track.ts add-seed hunter lookonchain
npx tsx Tools/following_Track/track.ts track
npx tsx Tools/following_Track/track.ts alerts 20
npx tsx Tools/following_Track/track.ts top 20
```

## Flow

1. `init-db` creates the following tracker schema.
2. `import-seeds` reads `Tools/following_Track/seeds.json`, resolves usernames through Twitter, and stores active seeds in Postgres.
3. `track` fetches paginated following lists for all active seeds, records follow edges, marks missing edges inactive, and generates multi-seed alerts.
4. `alerts` prints recent alerts.
5. `top` prints discovered accounts ranked by number of active seeds following them.

## Scoring

Alerts score accounts using:

- active seed overlap
- influencer plus hunter category diversity
- follower count
- crypto/project keywords in profile description
- account age under one year

The most important signal is seed overlap: accounts followed by several high-signal seeds are more likely to be active crypto influencers, builders, or early projects worth reviewing.
