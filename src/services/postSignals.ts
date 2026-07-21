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
  // Precision-first (no bare "mint" / "wl") — scoring drops weak matches further.
  nft: [
    "minting soon", "mint date", "mint is live", "minting is live",
    "public mint", "free mint", "whitelist mint", "wl mint",
    "reveal live", "reveal soon", "collection drop", "drop date",
    "official mint date", "confirmed mint date", "mint date announced",
    "mint date is", "mint date set", "mint schedule", "minting schedule",
    "mint window", "mint starts on", "mint opens on", "minting on",
    "we mint on", "mint goes live on", "public mint date", "wl mint date",
    "save the date", "mark your calendars", "mark your calendar",
    "wl open", "whitelist open", "allowlist open", "waitlist open",
    "mint in 1 hour", "mint starts in", "phase 1 mint", "og mint",
    // Structured mint-date patterns (month / numeric / weekday)
    /mint(?:ing)?\s*dates?\s*[:\-–—]?\s*(?:is\s+|set\s+(?:for\s+|to\s+)?|announced\s+)?(?:on\s+)?(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*\d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)?\s*(?:of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)|\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|tonight|today)/i,
    /mint(?:ing)?\s+(?:goes\s+live\s+|opens?\s+|starts?\s+|begins?\s+|live\s+)?(?:on\s+|this\s+)?(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*\d{1,2}(?:st|nd|rd|th)?|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|tonight)/i,
    /(?:public|free|wl|whitelist)?\s*mint(?:ing)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*\d{1,2}(?:st|nd|rd|th)?/i,
    /mint(?:ing)?\s*(?:@|at)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|utc|est|et|gmt)?/i,
    /mint(?:ing)?\s+(?:in|starts?\s+in)\s+\d+\s*(?:hours?|mins?|minutes?)/i,
  ],
  "nft-fi": ["mint is live", "floor", "collection drop", "mint date"],
  gamefi: [
    "game live", "game is live", "open beta", "closed beta", "playtest",
    "alpha test", "season 1 live", "season one", "early access", "play now",
    "download now", "tournament live",
  ],
  l1: [
    "mainnet is live", "mainnet live", "public mainnet", "mainnet launch",
    "public testnet", "testnet is live", "devnet live", "faucet live",
    "incentivized testnet", "genesis block", "genesis live", "network launch",
    "staking is live", "validator applications", "delegation open",
    /chain\s*id\s*[:\-]?\s*\d+/i,
  ],
  l2: [
    "mainnet is live", "mainnet live", "bridge live", "native bridge",
    "deposits open", "withdrawals live", "sequencer live",
    "public testnet", "testnet is live", "incentivized testnet",
    "op stack mainnet", "orbit mainnet", "cdk mainnet",
    /chain\s*id\s*[:\-]?\s*\d+/i,
  ],
  dex: ["trading live", "trading is live", "pool live", "liquidity live", "swap live", "swap is live", "now trading"],
  perps: ["trading live", "perps live", "market live", "now trading"],
  defi: [
    "vault live", "vault is live", "pool live", "markets live", "markets are live",
    "staking live", "staking is live", "farming live", "points program",
    "points are live", "season 1 live",
  ],
  "lending-yield": ["market live", "markets live", "vault live", "staking live", "yield live"],
  depin: [
    "node sale live", "node sale", "license sale", "network live",
    "rewards live", "mining live", "onboarding live", "device onboarding",
  ],
  launchpad: [
    "ido live", "sale live", "sale is live", "presale live", "public sale",
    "fair launch", "bonding curve live",
  ],
  "btc-eco": ["inscribe", "inscription", "rune", "runes live", "mint is live"],
  socialfi: ["invite codes", "beta live", "app live", "app is live", "download now"],
  ai: [
    "waitlist is open", "waitlist open", "join the waitlist",
    "closed beta", "open beta", "beta is live", "beta live",
    "api is live", "api live", "api access open", "developer api", "inference live",
    "model is live", "model live", "weights released",
    "app is live", "app live", "product is live", "product launch",
  ],
  "ai-agents": [
    "agent is live", "agent live", "agents live", "agent live now",
    "sdk live", "framework release", "agent launchpad live",
    "bonding complete", "graduated", "beta live", "waitlist open",
    /(?:\bca\b|contract)\s*[:\-]?\s*0x[a-fA-F0-9]{40}/i,
  ],
  tools: ["product launch", "bot live", "api key open", "app live"],
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
