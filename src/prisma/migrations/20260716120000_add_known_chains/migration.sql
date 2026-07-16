-- EVM chain catalog snapshot (chainlist.org / chainid.network)

CREATE TABLE "known_chains" (
    "chain_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "native_symbol" TEXT,
    "rpc_url" TEXT,
    "explorer_url" TEXT,
    "info_url" TEXT,
    "is_testnet" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'chainlist',
    "rpc_live" BOOLEAN,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alerted_at" TIMESTAMPTZ,

    CONSTRAINT "known_chains_pkey" PRIMARY KEY ("chain_id")
);

CREATE INDEX "known_chains_first_seen_at_idx" ON "known_chains"("first_seen_at" DESC);
CREATE INDEX "known_chains_is_testnet_first_seen_at_idx" ON "known_chains"("is_testnet", "first_seen_at" DESC);
