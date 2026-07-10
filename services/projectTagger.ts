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

// Load tags.json's vocabulary. In dev (tsx) this module lives at services/, so
// "../tags.json" is the repo root. Compiled to dist/services/, the same relative
// path points at dist/tags.json (populated by the build's copy step). We try
// both the dist-local copy and the repo root so it works either way and doesn't
// depend on the build copy having run.
const TAGS_CANDIDATES = ["../tags.json", "../../tags.json"] as const;

function loadRegistry(): { items: TagRegistryItem[] } {
  const errors: string[] = [];
  for (const rel of TAGS_CANDIDATES) {
    try {
      const raw = readFileSync(new URL(rel, import.meta.url), "utf8");
      return JSON.parse(raw) as { items: TagRegistryItem[] };
    } catch (err) {
      errors.push(`${rel}: ${(err as Error).message}`);
    }
  }
  throw new Error(
    `projectTagger: could not locate tags.json (tried ${TAGS_CANDIDATES.join(", ")}). ` +
      `Ensure the build copies tags.json into dist/. Details — ${errors.join(" | ")}`,
  );
}

const registry = loadRegistry();

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
  launchpad: [
    "launchpad", "launch pad", "token launch", "ido", "ico", "ido platform",
    "fair launch", "token sale", "presale", "pre-sale", "bonding curve",
    "pump.fun", "pumpfun", "letsbonk", "bonk.fun", "moonshot", "launchpool",
    "initial dex offering", "token generation event", "tge", "public sale",
  ],
  l1: [
    "layer 1", "layer-1", "layer1", "l1 blockchain", "l1 chain", "base layer",
    "monolithic blockchain", "smart contract platform", "evm chain",
    "evm-compatible", "evm compatible", "alt l1", "alt-l1", "sovereign chain",
    /\bl1\b/,
  ],
  l2: [
    "layer 2", "layer-2", "layer2", "rollup", "rollups", "optimistic rollup",
    "zk rollup", "zk-rollup", "zkrollup", "validium", "scaling solution",
    "ethereum scaling", "op stack", "opstack", "superchain", "arbitrum orbit",
    "based rollup", "sovereign rollup", /\bl2\b/,
  ],
  meme: [
    "meme", "memecoin", "memecoins", "meme coin", "meme coins", "memes",
    "meme token", "dog coin", "dogcoin", "shitcoin", "degen coin",
    "community coin", "meme culture", /\bpepe\b/, /\bdoge\b/, /\bwif\b/,
    /\bbonk\b/, /\bmog\b/,
  ],
  rwa: [
    "rwa", "rwas", "real world asset", "real-world asset", "real world assets",
    "tokenized asset", "tokenized assets", "tokenization", "asset tokenization",
    "tokenized treasuries", "tokenized real estate", "tokenize real world",
    "tokenized fund", "tokenized securities", "tokenized stocks",
    "tokenized bonds", "tokenized commodities",
  ],
  defi: [
    "defi", "de-fi", "decentralized finance", "amm", "automated market maker",
    "liquidity pool", "liquidity protocol", "money market", "yield farming",
    "yield aggregator", "yield optimizer", "vault", "vaults", "farming",
    "staking protocol", "collateral", "cdp", "over-collateralized",
    "leveraged yield", "defi protocol", /\btvl\b/,
  ],
  ai: [
    "ai", /\bartificial intelligence\b/, "machine learning", "deep learning",
    "llm", "llms", "large language model", "neural network", "neural nets",
    "generative ai", "gen ai", "ai model", "ai models", "ai infrastructure",
    "ai compute", "ai inference", "ai-powered", "ai powered", "ai native",
    "ai-native", "ai protocol", "foundation model", /\bgpt\b/,
  ],
  derivatives: [
    "derivatives", "derivative", "options trading", "options protocol",
    "on-chain options", "options vault", "futures", "structured products",
    "synthetic assets", "synthetic asset", "synths", "options dex",
  ],
  nft: [
    "nft", "nfts", "non-fungible", "non fungible", "mint", "minting",
    "collectible", "collectibles", "pfp", "pfps", "digital art",
    "generative art", "art collection", "1/1", "one of one", "opensea",
    "magic eden", "jpeg", "jpegs", "profile picture project", "nft collection",
    "nft project", "nft marketplace",
  ],
  "lending-yield": [
    "lending", "lend", "borrow", "borrowing", "yield", "staking rewards",
    "earn yield", "lending protocol", "lending market", "lending platform",
    "interest rate", "supply and borrow", "credit protocol", "money market",
    "undercollateralized lending", "yield-bearing", "yield bearing",
  ],
  depin: [
    "depin", "decentralized physical", "physical infrastructure",
    "decentralized wireless", "decentralized compute", "decentralized storage",
    "decentralized gpu", "gpu network", "wireless network", "sensor network",
    "decentralized energy", "iot network", "dephy", "physical infra",
  ],
  desci: [
    "desci", "decentralized science", "science dao", "biotech dao",
    "research dao", "longevity", "decentralized research", "open science",
  ],
  socialfi: [
    "socialfi", "social-fi", "social finance", "social token", "social tokens",
    "decentralized social", "web3 social", "creator economy", "social graph",
    "social network protocol", "friend.tech", "friendtech", "social app",
  ],
  tools: [
    "toolkit", "dev tools", "developer tools", "sdk", "analytics tool",
    "analytics platform", "dashboard", "trading tools", "trading bot",
    "telegram bot", "portfolio tracker", "block explorer", "charting",
    "terminal", "screener", "token screener", "sniping bot", "sniper bot",
    "trading terminal", "no-code", "no code", "automation tool",
  ],
  "ai-agents": [
    "ai agent", "ai agents", "autonomous agent", "autonomous agents",
    "agentic", "ai-agent", "agent framework", "agent swarm", "agent economy",
    "autonomous ai", "ai companion", "agentic ai", "ai swarm", "multi-agent",
    "agent-to-agent", "eliza framework",
  ],
  "infra-data": [
    "infrastructure", "indexer", "indexing", "data availability",
    "node infrastructure", "node operator", "validator", "middleware",
    "data layer", "data protocol", "on-chain data", "blockchain data",
    "subgraph", "api infrastructure", "compute layer", "sequencer",
    "co-processor", "coprocessor", "data infrastructure", /\brpc\b/, /\bda layer\b/,
  ],
  "dao-community": [
    "dao", "daos", "governance", "community-owned", "community owned",
    "on-chain governance", "decentralized autonomous", "governance token",
    "on-chain voting", "treasury management", "collective", "guild",
    "community dao", "governance protocol",
  ],
  dex: [
    "dex", "dexs", "dexes", "decentralized exchange", "swap", "swaps",
    "spot trading", "spot dex", "orderbook dex", "order book", "clob",
    "concentrated liquidity", "liquidity aggregator", "dex aggregator",
    "trading protocol", "spot exchange", "amm dex",
  ],
  gambling: [
    "gambling", "casino", "betting", "sportsbook", "lottery", "dice",
    "roulette", "wager", "gamble", "igaming", "on-chain casino",
    "degen casino", "coin flip", "coinflip", "jackpot", "raffle",
  ],
  stablecoin: [
    "stablecoin", "stablecoins", "stable coin", "stable coins", "pegged",
    "usd-pegged", "usd pegged", "dollar-backed", "dollar backed",
    "algorithmic stablecoin", "yield-bearing stablecoin", "synthetic dollar",
    "decentralized stablecoin",
  ],
  "btc-eco": [
    "bitcoin", "ordinals", "inscriptions", "brc-20", "brc20", "brc-721",
    "runes", "rune protocol", "bitcoin l2", "bitcoin layer 2", "stacks",
    "taproot", "bitcoin defi", "bitcoin ecosystem", "satoshis", "bitcoin nfts",
    /\bbtc\b/, /\bbrc\b/, /\bsats\b/,
  ],
  metaverse: [
    "metaverse", "virtual world", "virtual worlds", "virtual reality",
    "augmented reality", "open world", "3d world", "immersive world",
    "digital world", "virtual land", "spatial computing", /\bvr\b/,
  ],
  "cex-cefi": [
    "cex", "centralized exchange", "cefi", "crypto exchange", "trading platform",
    "custodial exchange", "order matching", "spot and futures exchange",
  ],
  "investment-entity": [
    "investment firm", "asset management", "investment entity", "asset manager",
    "investment dao", "portfolio management", "wealth management",
    "capital management", "investment platform", "digital asset manager",
  ],
  gamefi: [
    "gamefi", "game-fi", "gaming", "play to earn", "play-to-earn", "p2e",
    "web3 game", "web3 gaming", "web3 games", "blockchain game",
    "blockchain gaming", "on-chain game", "on-chain gaming", "move to earn",
    "move-to-earn", "gaming guild", "game economy", "nft game", "autobattler",
  ],
  "news-media": [
    "news", "media outlet", "newsletter", "journalism", "magazine", "podcast",
    "media company", "crypto media", "editorial", "press", "media platform",
    "daily alpha", "research and news", "content platform",
  ],
  services: [
    "consulting", "agency", "service provider", "marketing agency",
    "development agency", "audit firm", "auditing", "security audit",
    "kol agency", "pr agency", "advisory", "dev shop", "growth agency",
    "community management", "smart contract audit", "audits",
  ],
  defai: [
    "defai", "defi ai", "ai defi", "defi agent", "ai-powered defi",
    "autonomous defi", "ai trading agent", "agentic defi",
  ],
  "nft-fi": [
    "nftfi", "nft-fi", "nft lending", "nft finance", "nft-backed",
    "nft mortgage", "nft liquidity", "fractionalized nft", "nft perps",
    "nft derivatives", "nft financialization",
  ],
  "multi-chain": [
    "multichain", "multi-chain", "cross-chain", "cross chain", "omnichain",
    "interoperability", "interoperable", "chain-agnostic", "chain agnostic",
    "any chain", "all chains", "chain abstraction", "cross-chain protocol",
  ],
  perps: [
    "perps", "perp", "perpetuals", "perpetual futures", "perpetual swap",
    "perp dex", "perps dex", "perpetual dex", "perpetual exchange",
    "on-chain perps", "decentralized perps", "perp trading",
  ],
  funds: [
    "fund", "funds", "hedge fund", "liquidity fund", "index fund",
    "crypto fund", "on-chain fund", "tokenized fund", "quant fund",
    "venture fund",
  ],
  "erc-404": ["erc-404", "erc404", "404 token", "hybrid token standard"],
  studios: [
    "game studio", "creative studio", "dev studio", "development studio",
    "studios", "animation studio", "design studio", "web3 studio",
    "gaming studio", "venture studio", "product studio","play"
  ],
  lrt: [
    "lrt", "liquid restaking", "liquid restaking token", "restaking token",
    "restaked eth", "eigenlayer restaking", "restaking protocol",
  ],
  oracles: [
    "oracle", "oracles", "price feed", "price feeds", "data oracle",
    "decentralized oracle", "oracle network", "off-chain data", "data feeds",
    "price oracle", "oracle protocol",
  ],
  vc: [
    "venture capital", "vc firm", "venture firm", "early-stage investor",
    "early stage investor", "venture fund", "seed investor",
    "venture capitalist", "we invest in", "we back", "backing founders", /\bvc\b/,
  ],
  incubators: [
    "incubator", "incubators", "incubation", "incubating",
    "startup incubator", "project incubator",
  ],
  mms: [
    "market maker", "market making", "market makers", "liquidity provider",
    "liquidity providers", "liquidity provision", "designated market maker",
  ],
  accelerators: [
    "accelerator", "accelerators", "accelerator program", "startup accelerator",
    "growth accelerator",
  ],
  wallet: [
    "wallet", "wallets", "self-custody", "self custody", "non-custodial",
    "non-custodial wallet", "custodial wallet", "hardware wallet",
    "smart wallet", "mpc wallet", "seed phrase", "crypto wallet", "web3 wallet",
    "embedded wallet", "account abstraction",
  ],
  "erc-314": ["erc-314", "erc314", "314 standard"],
  lst: [
    "lst", "liquid staking", "liquid staking token", "staked eth",
    "liquid staked", "staking derivative", /\bsteth\b/,
  ],
  predict: [
    "prediction market", "prediction markets", "predict market",
    "predictions market", "betting market", "forecast market", "polymarket",
    "event contracts", "opinion trading", "event trading",
  ],
  bridge: [
    "bridge", "bridges", "cross-chain bridge", "token bridge", "bridging",
    "asset bridge", "interoperability bridge", "cross-chain messaging",
    "message passing", "canonical bridge",
  ],
  robotics: [
    "robotics", "robot", "robots", "humanoid", "humanoid robot", "embodied ai",
    "autonomous machines", "physical ai", "robot economy",
  ],
  x402: ["x402", "x-402", "http 402", "machine payments", "agentic payments"],
  privacy: [
    "privacy", "private transactions", "zero-knowledge", "zero knowledge",
    "zk-proofs", "zk proofs", "confidential", "anonymous", "mixer",
    "private payments", "fully homomorphic", "fhe", "stealth address",
    "shielded", "privacy-preserving", /\bzk\b/,
  ],
  dn404: ["dn404", "dn-404", "dn 404"],
  "erc-8004": ["erc-8004", "erc8004", "8004"],
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

// ── Username / handle detection ───────────────────────────────────────────
//
// Projects often encode their vertical in the handle itself (@unsealednft,
// @pixel_art, @someone_defi). We match the lowercased handle (@ stripped) in two
// tiers to keep recall high without tagging unrelated handles.

/**
 * Tokens matched against the handle only when bounded by an underscore, a digit,
 * or the handle edges — so `_nft`, `nft_`, `nft2`, and a bare `@nft` all hit,
 * but `@smart` / `@chair` do not. Safe for short/ambiguous tokens. `art` has no
 * slug of its own; it signals the NFT/art vertical, so it maps to `nft`.
 */
const HANDLE_TOKENS: Record<string, string[]> = {
  nft: ["nft", "art"],
  "nft-fi": ["nftfi"],
  ai: ["ai"],
  "ai-agents": ["agent", "agents"],
  defi: ["defi"],
  "dao-community": ["dao"],
  dex: ["dex", "swap"],
  meme: ["meme"],
  gamefi: ["gamefi", "gamer","play"],
  metaverse: ["meta"],
  socialfi: ["social"],
  wallet: ["wallet"],
  bridge: ["bridge"],
  rwa: ["rwa"],
  perps: ["perp", "perps"],
  lst: ["lst"],
  lrt: ["lrt"],
  vc: ["vc"],
  privacy: ["zk"],
  "btc-eco": ["btc"],
  l1: ["l1"],
  l2: ["l2"],
  depin: ["depin"],
  stablecoin: ["stable"],
};

/**
 * Distinctive tokens additionally allowed to match as a *glued suffix* at the end
 * of a handle (`@unsealednft` → nft, `@sushiswap` → dex). Curated to tokens that
 * rarely end unrelated words; short/common ones (art, dex, ai) are intentionally
 * excluded so `@smart` / `@codex` / `@chair` don't false-fire.
 */
const HANDLE_SUFFIX_TOKENS: Record<string, string[]> = {
  nft: ["nft"],
  "dao-community": ["dao"],
  gamefi: ["gamefi","play"],
  socialfi: ["socialfi"],
  defi: ["defi"],
  defai: ["defai"],
  depin: ["depin"],
  dex: ["swap"],
  perps: ["perps"],
  meme: ["meme"],
  wallet: ["wallet"],
};

for (const slug of [
  ...Object.keys(HANDLE_TOKENS),
  ...Object.keys(HANDLE_SUFFIX_TOKENS),
]) {
  if (!VALID_SLUGS.has(slug)) {
    throw new Error(
      `projectTagger: handle-token slug "${slug}" is not in tags.json`,
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

/** Handle tokens compiled to underscore/digit/edge-delimited matchers. */
const HANDLE_DELIM_COMPILED: [string, RegExp[]][] = Object.entries(
  HANDLE_TOKENS,
).map(([slug, tokens]) => [
  slug,
  tokens.map(
    (t) => new RegExp(`(?:^|[_\\d])${escapeRegExp(t)}(?:[_\\d]|$)`, "i"),
  ),
]);

/** Glued-suffix handle tokens: [slug, lowercased token]. */
const HANDLE_SUFFIX_COMPILED: [string, string][] = Object.entries(
  HANDLE_SUFFIX_TOKENS,
).flatMap(([slug, tokens]) => tokens.map((t): [string, string] => [slug, t.toLowerCase()]));

/** Lowercase a username and strip any leading `@`. */
function normalizeHandle(username?: string | null): string {
  return (username ?? "").toLowerCase().replace(/^@+/, "");
}

/** Slugs implied by the handle itself (both delimited and glued-suffix tiers). */
function tagsFromHandle(username?: string | null): string[] {
  const handle = normalizeHandle(username);
  if (!handle) return [];

  const matched: string[] = [];
  for (const [slug, patterns] of HANDLE_DELIM_COMPILED) {
    if (patterns.some((re) => re.test(handle))) matched.push(slug);
  }
  for (const [slug, token] of HANDLE_SUFFIX_COMPILED) {
    if (handle.endsWith(token)) matched.push(slug);
  }
  return matched;
}

export interface ClassifiableAccount {
  username?: string | null;
  name?: string | null;
  description?: string | null;
}

/** Fallback slug applied when nothing else matches (exists in tags.json). */
export const DEFAULT_SLUG = "unknown";

/**
 * Infer project-type tag slugs for an account from its username, name, and
 * description. Returns a de-duplicated array of valid slugs. When nothing
 * matches (or all fields are empty), falls back to `["unknown"]` so every
 * account carries at least one tag.
 */
export function classifyAccount(account: ClassifiableAccount): string[] {
  const matched = new Set<string>();

  const haystack = `${account.name ?? ""} ${account.description ?? ""}`;
  if (haystack.trim()) {
    for (const [slug, patterns] of COMPILED) {
      if (patterns.some((re) => re.test(haystack))) matched.add(slug);
    }
  }

  for (const slug of tagsFromHandle(account.username)) matched.add(slug);

  return matched.size > 0 ? [...matched] : [DEFAULT_SLUG];
}
