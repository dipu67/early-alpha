// Project-type tagger — a local, deterministic keyword classifier.
//
// Given a Twitter account's name + description, it infers which of Moni's
// project-type tags apply (see tags.json at the repo root) and returns their
// slugs. No network, no auth: the vocabulary is loaded once from tags.json and
// matched against a hand-authored keyword lexicon.
//
// Usage:
//   import { classifyAccount } from "../services/projectTagger.js";
//   const tags = classifyAccount({ name, description }); // e.g. ["defi", "ai"]

import { readFileSync } from "node:fs";

/** One entry in tags.json's `items` array (only the fields we use). */
interface TagRegistryItem {
  slug: string;
  name: string;
}

// tags.json lives at the repo root, one level up from services/. Read it
// synchronously at module load — it is tiny and never changes at runtime. This
// avoids JSON import-assertion friction under the project's ESM config.
const registry = JSON.parse(
  readFileSync(new URL("../tags.json", import.meta.url), "utf8"),
) as { items: TagRegistryItem[] };

/** Every slug the registry knows about — the classifier can never emit anything outside this. */
export const VALID_SLUGS: ReadonlySet<string> = new Set(
  registry.items.map((i) => i.slug),
);

/** slug → human-readable label from tags.json (e.g. "ai-agents" → "AI Agents"). */
const SLUG_LABELS: ReadonlyMap<string, string> = new Map(
  registry.items.map((i) => [i.slug, i.name]),
);

/** Human-readable display name for a slug; falls back to the slug itself. */
export function tagLabel(slug: string): string {
  return SLUG_LABELS.get(slug) ?? slug;
}

/**
 * Keyword lexicon keyed by tag slug. A match on ANY entry tags the account with
 * that slug. Strings are matched as whole words (word-boundary), regexes are
 * used as-is. Buckets that can't be inferred from a bio (`other`, `unknown`)
 * are intentionally omitted.
 *
 * Keep this in sync with tags.json — the assertion below fails loudly if a key
 * here isn't a real slug.
 */
const SLUG_KEYWORDS: Record<string, (string | RegExp)[]> = {
  launchpad: ["launchpad", "launch pad", "token launch", "ido platform", "fair launch"],
  l1: ["layer 1", "layer-1", "l1 blockchain", /\bl1\b/],
  l2: ["layer 2", "layer-2", "rollup", "optimistic rollup", "zk rollup", "zk-rollup", /\bl2\b/],
  meme: ["meme", "memecoin", "meme coin", "memes"],
  rwa: ["rwa", "real world asset", "real-world asset", "tokenized asset", "tokenization"],
  defi: ["defi", "decentralized finance", "amm", "liquidity", "money market", "yield farming"],
  ai: ["ai", /\bartificial intelligence\b/, "machine learning", "llm", "neural"],
  derivatives: ["derivatives", "options trading", "futures"],
  nft: ["nft", "nfts", "non-fungible", "mint", "collectible", "pfp"],
  "lending-yield": ["lending", "borrow", "yield", "staking rewards"],
  depin: ["depin", "decentralized physical", "physical infrastructure"],
  desci: ["desci", "decentralized science"],
  socialfi: ["socialfi", "social-fi", "social finance"],
  tools: ["toolkit", "dev tools", "developer tools", "sdk", "analytics tool"],
  "ai-agents": ["ai agent", "ai agents", "autonomous agent", "agentic", "ai-agent"],
  "infra-data": ["infrastructure", "indexer", "data availability", "rpc", "node infrastructure"],
  "dao-community": ["dao", "governance", "community-owned", "on-chain governance"],
  dex: ["dex", "decentralized exchange", "swap", "spot trading"],
  gambling: ["gambling", "casino", "betting", "lottery"],
  stablecoin: ["stablecoin", "stable coin", "pegged"],
  "btc-eco": ["bitcoin", "btc", "ordinals", "inscriptions", "brc-20", "brc20", "runes"],
  metaverse: ["metaverse", "virtual world", "virtual reality"],
  "cex-cefi": ["cex", "centralized exchange", "cefi"],
  "investment-entity": ["investment firm", "asset management", "investment entity"],
  gamefi: ["gamefi", "game-fi", "play to earn", "play-to-earn", "p2e", "web3 game", "web3 gaming"],
  "news-media": ["news", "media outlet", "newsletter", "journalism"],
  services: ["consulting", "agency", "service provider"],
  defai: ["defai"],
  "nft-fi": ["nftfi", "nft-fi", "nft lending", "nft finance"],
  "multi-chain": ["multichain", "multi-chain", "cross-chain", "omnichain", "interoperability"],
  perps: ["perps", "perpetuals", "perpetual futures", "perp dex"],
  funds: ["fund", "hedge fund", "liquidity fund"],
  "erc-404": ["erc-404", "erc404"],
  studios: ["game studio", "creative studio", "dev studio", "studios"],
  lrt: ["lrt", "liquid restaking", "restaking token"],
  oracles: ["oracle", "oracles", "price feed", "price feeds"],
  vc: ["venture capital", "vc firm", "early-stage investor"],
  incubators: ["incubator", "incubation"],
  mms: ["market maker", "market making", "liquidity provider"],
  accelerators: ["accelerator", "accelerator program"],
  wallet: ["wallet", "self-custody", "non-custodial wallet"],
  "erc-314": ["erc-314", "erc314"],
  lst: ["lst", "liquid staking", "liquid staking token"],
  predict: ["prediction market", "prediction markets", "predict market"],
  bridge: ["bridge", "cross-chain bridge", "token bridge"],
  robotics: ["robotics", "robot", "humanoid"],
  x402: ["x402"],
  privacy: ["privacy", "zero-knowledge", "zero knowledge", "zk privacy", "confidential"],
  dn404: ["dn404", "dn-404"],
  "erc-8004": ["erc-8004", "erc8004"],
};

// Dev-time invariant: every lexicon key must be a real registry slug, so the
// classifier's output can never drift from tags.json.
for (const slug of Object.keys(SLUG_KEYWORDS)) {
  if (!VALID_SLUGS.has(slug)) {
    throw new Error(
      `projectTagger: "${slug}" is not a slug in tags.json — update the lexicon or the registry`,
    );
  }
}

/** Escape a plain-string keyword for safe embedding in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile each keyword into a word-boundary matcher once, at module load. */
const COMPILED: [string, RegExp[]][] = Object.entries(SLUG_KEYWORDS).map(
  ([slug, keywords]) => [
    slug,
    keywords.map((k) =>
      k instanceof RegExp
        ? new RegExp(k.source, k.flags.includes("i") ? k.flags : k.flags + "i")
        : new RegExp(`\\b${escapeRegExp(k)}\\b`, "i"),
    ),
  ],
);

export interface ClassifiableAccount {
  name?: string | null;
  description?: string | null;
}

/**
 * Infer project-type tag slugs for an account from its name + description.
 * Returns a de-duplicated array of valid slugs, or `[]` when nothing matches.
 */
export function classifyAccount(account: ClassifiableAccount): string[] {
  const haystack = `${account.name ?? ""} ${account.description ?? ""}`;
  if (!haystack.trim()) return [];

  const matched: string[] = [];
  for (const [slug, patterns] of COMPILED) {
    if (patterns.some((re) => re.test(haystack))) {
      matched.push(slug);
    }
  }
  return matched;
}
