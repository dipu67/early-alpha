CREATE TABLE IF NOT EXISTS twitter_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  followers_count INTEGER,
  following_count INTEGER,
  is_blue_verified BOOLEAN,
  profile_image_url TEXT,
  created_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seed_accounts (
  id BIGSERIAL PRIMARY KEY,
  twitter_id TEXT UNIQUE REFERENCES twitter_accounts(id),
  username TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('influencer', 'hunter')),
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tracking_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error TEXT,
  seeds_processed INTEGER NOT NULL DEFAULT 0,
  accounts_seen INTEGER NOT NULL DEFAULT 0,
  new_follow_edges INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS follow_edges (
  seed_id BIGINT NOT NULL REFERENCES seed_accounts(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES twitter_accounts(id) ON DELETE CASCADE,
  first_seen_run_id BIGINT REFERENCES tracking_runs(id),
  last_seen_run_id BIGINT REFERENCES tracking_runs(id),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (seed_id, following_id)
);

CREATE INDEX IF NOT EXISTS follow_edges_following_id_idx ON follow_edges(following_id);
CREATE INDEX IF NOT EXISTS follow_edges_active_idx ON follow_edges(active);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  following_id TEXT NOT NULL REFERENCES twitter_accounts(id) ON DELETE CASCADE,
  run_id BIGINT REFERENCES tracking_runs(id),
  alert_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  seed_count INTEGER NOT NULL,
  categories TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  seed_usernames TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (following_id, alert_type)
);

CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_score_idx ON alerts(score DESC);
