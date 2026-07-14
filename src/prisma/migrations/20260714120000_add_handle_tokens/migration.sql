-- Handle / username token matchers for the project tagger (admin-editable).
ALTER TABLE "project_tags" ADD COLUMN "handle_tokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "project_tags" ADD COLUMN "handle_suffix_tokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Seed former hard-coded HANDLE_TOKENS (only where the tag row already exists).
UPDATE "project_tags" SET "handle_tokens" = ARRAY['nft','art']::TEXT[] WHERE "slug" = 'nft';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['nftfi']::TEXT[] WHERE "slug" = 'nft-fi';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['ai']::TEXT[] WHERE "slug" = 'ai';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['agent','agents']::TEXT[] WHERE "slug" = 'ai-agents';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['defi']::TEXT[] WHERE "slug" = 'defi';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['dao']::TEXT[] WHERE "slug" = 'dao-community';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['dex','swap']::TEXT[] WHERE "slug" = 'dex';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['meme']::TEXT[] WHERE "slug" = 'meme';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['gamefi','gamer','play','mmo','rpg','game']::TEXT[] WHERE "slug" = 'gamefi';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['meta']::TEXT[] WHERE "slug" = 'metaverse';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['social']::TEXT[] WHERE "slug" = 'socialfi';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['wallet']::TEXT[] WHERE "slug" = 'wallet';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['bridge']::TEXT[] WHERE "slug" = 'bridge';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['rwa']::TEXT[] WHERE "slug" = 'rwa';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['perp','perps']::TEXT[] WHERE "slug" = 'perps';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['lst']::TEXT[] WHERE "slug" = 'lst';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['lrt']::TEXT[] WHERE "slug" = 'lrt';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['vc']::TEXT[] WHERE "slug" = 'vc';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['zk']::TEXT[] WHERE "slug" = 'privacy';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['btc']::TEXT[] WHERE "slug" = 'btc-eco';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['l1']::TEXT[] WHERE "slug" = 'l1';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['l2']::TEXT[] WHERE "slug" = 'l2';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['depin']::TEXT[] WHERE "slug" = 'depin';
UPDATE "project_tags" SET "handle_tokens" = ARRAY['stable']::TEXT[] WHERE "slug" = 'stablecoin';

-- Seed former hard-coded HANDLE_SUFFIX_TOKENS.
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['nft']::TEXT[] WHERE "slug" = 'nft';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['dao']::TEXT[] WHERE "slug" = 'dao-community';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['gamefi','play','mmo','rpg','game']::TEXT[] WHERE "slug" = 'gamefi';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['socialfi']::TEXT[] WHERE "slug" = 'socialfi';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['defi']::TEXT[] WHERE "slug" = 'defi';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['defai']::TEXT[] WHERE "slug" = 'defai';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['depin']::TEXT[] WHERE "slug" = 'depin';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['swap']::TEXT[] WHERE "slug" = 'dex';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['perps']::TEXT[] WHERE "slug" = 'perps';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['meme']::TEXT[] WHERE "slug" = 'meme';
UPDATE "project_tags" SET "handle_suffix_tokens" = ARRAY['wallet']::TEXT[] WHERE "slug" = 'wallet';
