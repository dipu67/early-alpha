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
    "gaming studio", "venture studio", "product studio",
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
