// Post-signal detection — spots time-sensitive "alpha" moments in a tweet body.
//
// Given a tweet's text (and optionally the tag/list slug that surfaced it), it
// returns which signal types fired — e.g. an NFT project posting "public mint
// goes live Friday" yields ["mint", "mint date"]. Only posts with at least one
// signal are worth a Telegram alert.
//
// Matching mirrors projectTagger: plain strings are whole-word, regexes as-is,
// all case-insensitive and compiled once at module load.

/**
 * Signals that matter for any project type — launches, token events, listings.
 * These fire regardless of the list a post came from.
 */
const GENERIC_SIGNALS: (string | RegExp)[] = [
  "tge", "token generation event", "token launch", "launch date", "launching",
  "going live", "live now", "now live", "mainnet", "mainnet live",
  "airdrop", "airdrop live", "snapshot", "claim live", "claim your",
  "presale", "pre-sale", "public sale", "whitelist", "allowlist",
  "listing", "listed on", "now trading", "trading live", "points program",
  "waitlist", "early access", "sign up", "register now", "campaign live",
];

/**
 * Per-slug signals layered on top of the generic set. Keyed by tag slug so a
 * post from the NFT list is checked for mint language, a GameFi post for
 * playtests, etc. Slugs not listed here fall back to the generic set only.
 */
const SLUG_SIGNALS: Record<string, (string | RegExp)[]> = {
  nft: [
    "mint", "minting", "minting soon", "mint date", "mint is live",
    "public mint", "free mint", "whitelist mint", "wl mint", "reveal",
    "reveal soon", "collection drop", "drop date",
  ],
  "nft-fi": ["mint", "minting", "floor", "collection drop"],
  gamefi: [
    "game live", "game is live", "open beta", "closed beta", "playtest",
    "alpha test", "season 1", "season one", "early access", "play now",
    "download now", "tournament",
  ],
  dex: ["trading live", "pool live", "liquidity live", "swap live", "now trading"],
  perps: ["trading live", "perps live", "market live", "now trading"],
  defi: ["vault live", "pool live", "staking live", "farming live", "points program"],
  "lending-yield": ["market live", "vault live", "staking live", "yield live"],
  depin: ["node sale", "node live", "device", "hardware", "miner", "onboarding live"],
  launchpad: ["ido", "ino", "sale live", "sale is live", "presale live", "public sale"],
  "btc-eco": ["inscribe", "inscription", "rune", "runes live", "mint"],
  socialfi: ["invite", "beta live", "app live", "download now"],
  ai: ["beta live", "api live", "model live", "app live", "waitlist"],
  "ai-agents": ["agent live", "beta live", "waitlist", "launch"],
  predict: ["market live", "trade now", "resolve"],
};

/** Escape a plain-string keyword for safe embedding in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile a keyword to a whole-word, case-insensitive matcher (regexes pass through). */
function compile(k: string | RegExp): RegExp {
  return k instanceof RegExp
    ? new RegExp(k.source, k.flags.includes("i") ? k.flags : k.flags + "i")
    : new RegExp(`\\b${escapeRegExp(k)}\\b`, "i");
}

// The label we report is the human keyword itself (the plain string, or the
// regex source), so an alert can show exactly what matched.
type CompiledSignal = { label: string; re: RegExp };

function compileList(keywords: (string | RegExp)[]): CompiledSignal[] {
  return keywords.map((k) => ({
    label: k instanceof RegExp ? k.source : k,
    re: compile(k),
  }));
}

const GENERIC_COMPILED = compileList(GENERIC_SIGNALS);
const SLUG_COMPILED: Record<string, CompiledSignal[]> = Object.fromEntries(
  Object.entries(SLUG_SIGNALS).map(([slug, kws]) => [slug, compileList(kws)]),
);

/**
 * Detect signal keywords in a tweet. Checks the generic set plus any signals
 * specific to `slug` (the list the post came from). Returns a de-duplicated
 * array of the matched keyword labels, or `[]` when nothing fires.
 */
export function detectSignals(text: string, slug?: string): string[] {
  if (!text.trim()) return [];

  const pools = [GENERIC_COMPILED];
  if (slug && SLUG_COMPILED[slug]) pools.push(SLUG_COMPILED[slug]);

  const matched = new Set<string>();
  for (const pool of pools) {
    for (const { label, re } of pool) {
      if (re.test(text)) matched.add(label);
    }
  }
  return [...matched];
}
