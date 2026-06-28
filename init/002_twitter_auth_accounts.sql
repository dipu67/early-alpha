CREATE TABLE IF NOT EXISTS twitter_auth_accounts (
  id BIGSERIAL PRIMARY KEY,
  label TEXT,
  auth_token TEXT NOT NULL UNIQUE,
  ct0 TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limited_until TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS twitter_auth_accounts_available_idx
  ON twitter_auth_accounts (is_active, rate_limited_until);
