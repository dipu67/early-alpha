// DB-backed signal rules. New posts are checked against ALL enabled rules:
//   1) generic (slug = null) — mint, wl, tge, launch, …
//   2) tag-specific (slug = "nft", …) when the scan/list has a tag
// Any match → PostAlert + Telegram "signal".

import { prisma } from "../db/prisma.js";

export type SignalRuleSeed = {
  slug: string | null;
  category: string;
  label: string;
  pattern: string;
  isRegex?: boolean;
};

function g(category: string, label: string, pattern = label): SignalRuleSeed {
  return { slug: null, category, label, pattern };
}
/** Generic (all-tags) regex rule. */
function gr(category: string, label: string, pattern: string): SignalRuleSeed {
  return { slug: null, category, label, pattern, isRegex: true };
}
function t(
  slug: string,
  category: string,
  label: string,
  pattern = label,
): SignalRuleSeed {
  return { slug, category, label, pattern };
}
/** Tag-specific regex rule (isRegex: true). */
function tr(
  slug: string,
  category: string,
  label: string,
  pattern: string,
): SignalRuleSeed {
  return { slug, category, label, pattern, isRegex: true };
}
// Shared date fragments for mint-date regexes
const RE_MONTH =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const RE_DOW =
  "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun";
/** 15th / 1st / 2nd / 3rd / 15 */
const RE_DOM = "\\d{1,2}(?:st|nd|rd|th)?";
/** 03/15, 3-15-2025, 15.03.25 */
const RE_NUMERIC_DATE =
  "\\d{1,2}[\\/\\-\\.]\\d{1,2}(?:[\\/\\-\\.]\\d{2,4})?";

/**
 * Default detection lexicon.
 * Generic rules apply to every tag scan (nft, accelerators, …).
 * Tag rows add extra phrases for that vertical.
 */
export const DEFAULT_SIGNAL_RULES: SignalRuleSeed[] = [
  // ── Mint (generic — any project post) ──
  g("mint", "mint live"),
  g("mint", "mint is live"),
  g("mint", "minting live"),
  g("mint", "minting is live"),
  g("mint", "public mint"),
  g("mint", "free mint"),
  g("mint", "mint date"),
  g("mint", "minting soon"),
  g("mint", "mint opens"),
  g("mint", "mint starts"),
  g("mint", "mint starting"),
  g("mint", "now minting"),
  g("mint", "minting now"),
  g("mint", "mint is open"),
  g("mint", "mint open"),
  g("mint", "mint begins"),
  g("mint", "mint goes live"),
  g("mint", "minting goes live"),
  g("mint", "collection drop"),
  g("mint", "drop date"),
  g("mint", "reveal soon"),
  g("mint", "reveal live"),

  // ── Whitelist / allowlist / WL (generic) ──
  g("wl", "wl live"),
  g("wl", "wl is live"),
  g("wl", "wl open"),
  g("wl", "wl is open"),
  g("wl", "wl opens"),
  g("wl", "wl application"),
  g("wl", "wl applications"),
  g("wl", "wl form"),
  g("wl", "wl apply"),
  g("wl", "apply for wl"),
  g("wl", "apply for whitelist"),
  g("wl", "whitelist live"),
  g("wl", "whitelist is live"),
  g("wl", "whitelist open"),
  g("wl", "whitelist is open"),
  g("wl", "whitelist opens"),
  g("wl", "whitelist application"),
  g("wl", "whitelist form"),
  g("wl", "allowlist live"),
  g("wl", "allowlist open"),
  g("wl", "allowlist is open"),
  g("wl", "allowlist application"),
  g("wl", "register for wl"),
  g("wl", "wl registration"),
  g("wl", "guaranteed wl"),
  g("wl", "fcfs wl"),
  g("wl", "whitelist mint"),
  g("wl", "wl mint"),

  // ── TGE / token ──
  g("tge", "tge"),
  g("tge", "token generation event"),
  g("tge", "token launch"),
  g("tge", "token live"),
  g("tge", "claim live"),
  g("tge", "claim is live"),
  g("tge", "claim your"),
  g("tge", "airdrop live"),
  g("tge", "airdrop is live"),
  g("tge", "snapshot"),

  // ── Launch / live ──
  g("launch", "going live"),
  g("launch", "live now"),
  g("launch", "now live"),
  g("launch", "launch date"),
  g("launch", "launching"),
  g("launch", "mainnet live"),
  g("launch", "mainnet is live"),
  g("launch", "app live"),
  g("launch", "beta live"),
  g("launch", "early access"),

  // ── Sale / listing ──
  g("sale", "presale"),
  g("sale", "pre-sale"),
  g("sale", "public sale"),
  g("sale", "sale live"),
  g("sale", "sale is live"),
  g("sale", "now trading"),
  g("sale", "trading live"),
  g("sale", "listed on"),
  g("sale", "listing"),

  // ── Waitlist / signup ──
  g("wl", "waitlist"),
  g("wl", "wait list"),
  g("wl", "waitlist open"),
  g("wl", "waitlist is open"),
  g("wl", "waitlist live"),
  g("other", "campaign live"),
  g("other", "points program"),

  // ── Early-project / lifecycle phrases (generic — was only under nft) ──
  // Untagged early accounts must catch these; keep under generic not nft-only.
  g("mint", "you can mint now"),
  g("mint", "mint page is live"),
  g("mint", "mint portal is live"),
  g("mint", "public mint is live"),
  g("mint", "wl mint is live"),
  g("mint", "minting is open"),
  g("mint", "we're minting"),
  g("mint", "we are minting"),
  g("mint", "mint starts today"),
  g("mint", "mint opens today"),
  g("mint", "minting starts"),
  g("mint", "mint is starting"),
  g("mint", "official mint"),
  g("mint", "mint.fun"),
  g("mint", "metadata reveal"),
  g("wl", "al is open"),
  g("wl", "gtd wl"),
  g("wl", "gwl open"),
  g("wl", "raffle open"),
  g("wl", "raffle is live"),
  g("wl", "premint live"),
  g("wl", "wl form is live"),
  g("wl", "applications are open"),
  g("wl", "holder wl"),
  g("wl", "collab wl"),
  g("wl", "wl closes"),
  g("wl", "last chance for wl"),
  g("wl", "allowlist is live"),

  // ── Mint schedule / date (generic — early projects often untagged) ──
  g("mint_date", "mint date"),
  g("mint_date", "minting date"),
  g("mint_date", "official mint date"),
  g("mint_date", "confirmed mint date"),
  g("mint_date", "mint date announced"),
  g("mint_date", "mint date is"),
  g("mint_date", "mint date set"),
  g("mint_date", "mint calendar"),
  g("mint_date", "save the date"),
  g("mint_date", "mark your calendars"),
  g("mint_date", "mark your calendar"),
  g("mint_date", "public mint date"),
  g("mint_date", "wl mint date"),
  g("mint_date", "whitelist mint date"),
  g("mint_date", "mint schedule"),
  g("mint_date", "minting schedule"),
  g("mint_date", "mint window"),
  g("mint_date", "mint timeline"),
  g("mint_date", "full mint schedule"),
  g("mint_date", "mint starts on"),
  g("mint_date", "mint opens on"),
  g("mint_date", "minting on"),
  g("mint_date", "mint on"),
  g("mint_date", "we mint on"),
  g("mint_date", "mint goes live on"),
  g("mint_date", "minting goes live on"),
  g("mint_date", "phase 1 mint"),
  g("mint_date", "og mint"),
  g("mint_date", "holder mint"),
  g("mint_time", "mint in 1 hour"),
  g("mint_time", "mint in 2 hours"),
  g("mint_time", "mint starts in"),
  g("mint_time", "minting in"),
  g("mint_params", "per wallet"),
  g("mint_params", "max 1 per wallet"),
  g("mint_params", "max 2 per wallet"),
  g("mint_params", "mint price"),
  g("mint_params", "mint price:"),
  g("mint_params", "supply:"),
  g("mint_params", "total supply"),

  // Structured regexes — generic so early pool hits without nft tag
  gr(
    "mint_time",
    "mint in N hours/mins",
    `mint(?:ing)?\\s+(?:in|starts?\\s+in|opens?\\s+in)\\s+\\d+\\s*(?:minutes?|mins?|hours?|hrs?|h|m)\\b`,
  ),
  gr(
    "tba",
    "mint field TBA",
    `mint\\s*(?:date|price|time|schedule)\\s*[:\\-]?\\s*(?:tba|tbd)\\b`,
  ),
  gr(
    "mint_params",
    "mint field card",
    `(?:^|\\n)\\s*(?:•|\\*|●|-)?\\s*(?:mint\\s*date|mint\\s*price|supply|total\\s*supply|blockchain|chain)\\s*[:\\-]`,
  ),
  gr(
    "mint_date",
    "phase line",
    `phase\\s*[123]\\s*[:\\-].{0,40}(?:mint|wl|public|fcfs|guaranteed)`,
  ),
  gr(
    "mint_date",
    "wl public mint pair",
    `wl\\s*mint\\s*[:\\-].{0,40}public\\s*mint|public\\s*mint\\s*[:\\-].{0,40}wl\\s*mint`,
  ),
  gr(
    "mint_date",
    "mint date + calendar",
    `mint(?:ing)?\\s*dates?\\s*[:\\-–—]?\\s*(?:is\\s+|set\\s+(?:for\\s+|to\\s+)?|announced\\s+)?(?:on\\s+)?(?:(?:${RE_MONTH})\\s*${RE_DOM}|${RE_DOM}\\s*(?:of\\s+)?(?:${RE_MONTH})|${RE_NUMERIC_DATE}|(?:${RE_DOW})|tomorrow|tonight|today)`,
  ),
  gr(
    "mint_date",
    "mint on + date",
    `mint(?:ing)?\\s+(?:goes\\s+live\\s+|opens?\\s+|starts?\\s+|begins?\\s+|live\\s+)?(?:on\\s+|this\\s+)?(?:(?:${RE_MONTH})\\s*${RE_DOM}|${RE_DOM}\\s*(?:of\\s+)?(?:${RE_MONTH})|${RE_NUMERIC_DATE}|(?:${RE_DOW})|tomorrow|tonight)`,
  ),
  gr(
    "mint_date",
    "mint + month day",
    `(?:public|free|wl|whitelist|allowlist|guaranteed)?\\s*mint(?:ing)?\\s+(?:${RE_MONTH})\\s*${RE_DOM}`,
  ),
  gr(
    "mint_date",
    "mint date emoji",
    `(?:🗓️|📅|🗓).{0,40}mint|(?:mint(?:ing)?\\s*date).{0,20}(?:🗓️|📅|🗓)`,
  ),
  gr(
    "mint_time",
    "mint time slot",
    `mint(?:ing)?\\s*(?:@|at)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|utc|est|et|gmt|pst|pt)?`,
  ),
  gr(
    "mint_date",
    "mint ISO date",
    `mint(?:ing)?[^\\n]{0,30}\\d{4}-\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}[^\\n]{0,30}mint`,
  ),

  // ── NFT tag-only extras (nft-specific slang, not shared lifecycle) ──
  t("nft", "mint", "metadata reveal"),
  t("nft", "wl", "premint live"),
  t("nft", "wl", "collab wl"),
  t("nft", "wl", "holder wl"),
  t("nft", "mint", "gen2 mint"),
  t("nft", "mint", "gen 2 mint"),
  t("nft", "mint", "fcfs mint"),
  t("nft", "mint", "guaranteed mint"),
  t("nft", "sale", "secondary is live"),

  // ── GameFi ──
  t("gamefi", "launch", "game live"),
  t("gamefi", "launch", "game is live"),
  t("gamefi", "launch", "open beta"),
  t("gamefi", "launch", "closed beta"),
  t("gamefi", "launch", "playtest"),
  t("gamefi", "launch", "alpha test"),
  t("gamefi", "launch", "play now"),
  t("gamefi", "launch", "season 1 live"),
  t("gamefi", "launch", "tournament live"),
  t("gamefi", "launch", "download now"),

  // ── Token / TGE (generic precision extras) ──
  g("tge", "tge is live"),
  g("tge", "claim portal"),
  g("tge", "claim portal live"),
  g("tge", "eligibility checker"),
  g("tge", "checker live"),
  g("tge", "token is live"),
  g("tge", "snapshot tomorrow"),
  g("tge", "snapshot at"),
  g("sale", "spot listing"),
  g("sale", "futures listing"),
  g("sale", "listed on binance"),
  g("sale", "listed on bybit"),
  g("sale", "listed on okx"),
  g("sale", "listed on upbit"),

  // ── Chain generic ──
  g("chain", "mainnet live"),
  g("chain", "mainnet is live"),
  g("chain", "public mainnet"),
  g("chain", "chain is live"),
  g("chain", "sequencer live"),
  g("chain", "genesis block"),
  g("chain", "genesis live"),
  g("chain", "network launch"),
  g("chain", "new L2"),
  g("chain", "new rollup"),
  g("chain", "appchain live"),
  g("chain", "testnet to mainnet"),
  g("chain", "public testnet"),
  g("chain", "testnet is live"),
  g("chain", "devnet live"),
  g("chain", "faucet live"),
  g("chain", "incentivized testnet"),
  g("chain", "bridge live"),
  g("chain", "native bridge"),
  g("chain", "deposits open"),
  g("chain", "withdrawals live"),
  g("chain", "staking is live"),
  g("chain", "delegation open"),
  g("chain", "validator applications"),

  // ── L1 tag ──
  t("l1", "mainnet", "mainnet is live"),
  t("l1", "mainnet", "mainnet live"),
  t("l1", "mainnet", "public mainnet"),
  t("l1", "mainnet", "mainnet launch"),
  t("l1", "testnet", "public testnet"),
  t("l1", "testnet", "testnet is live"),
  t("l1", "testnet", "devnet live"),
  t("l1", "testnet", "faucet live"),
  t("l1", "testnet", "incentivized testnet"),
  t("l1", "testnet", "testnet rewards"),
  t("l1", "genesis", "genesis block"),
  t("l1", "genesis", "genesis live"),
  t("l1", "genesis", "network launch"),
  t("l1", "validator", "validator applications"),
  t("l1", "validator", "staking is live"),
  t("l1", "validator", "delegation open"),
  tr(
    "l1",
    "mainnet",
    "chain id field",
    `chain\\s*id\\s*[:\\-]?\\s*\\d{1,10}`,
  ),
  tr(
    "l1",
    "mainnet",
    "rpc field",
    `rpc(?:\\s*url)?\\s*[:\\-]?\\s*https?:\\/\\/`,
  ),

  // ── L2 tag ──
  t("l2", "mainnet", "mainnet is live"),
  t("l2", "mainnet", "mainnet live"),
  t("l2", "mainnet", "public mainnet"),
  t("l2", "bridge", "bridge live"),
  t("l2", "bridge", "native bridge"),
  t("l2", "bridge", "deposits open"),
  t("l2", "bridge", "withdrawals live"),
  t("l2", "bridge", "sequencer live"),
  t("l2", "testnet", "public testnet"),
  t("l2", "testnet", "testnet is live"),
  t("l2", "testnet", "incentivized testnet"),
  t("l2", "stack", "op stack mainnet"),
  t("l2", "stack", "orbit mainnet"),
  t("l2", "stack", "cdk mainnet"),
  t("l2", "stack", "zk stack mainnet"),
  t("l2", "decentralize", "fraud proofs live"),
  t("l2", "decentralize", "validity proofs live"),
  t("l2", "decentralize", "stage 1"),
  t("l2", "decentralize", "stage 2"),
  tr(
    "l2",
    "mainnet",
    "chain id field",
    `chain\\s*id\\s*[:\\-]?\\s*\\d{1,10}`,
  ),

  // ── AI ──
  t("ai", "waitlist", "waitlist is open"),
  t("ai", "waitlist", "join the waitlist"),
  t("ai", "waitlist", "waitlist open"),
  t("ai", "beta", "closed beta"),
  t("ai", "beta", "open beta"),
  t("ai", "beta", "beta is live"),
  t("ai", "beta", "beta live"),
  t("ai", "beta", "beta access"),
  t("ai", "api", "api is live"),
  t("ai", "api", "api live"),
  t("ai", "api", "api access open"),
  t("ai", "api", "developer api"),
  t("ai", "api", "inference live"),
  t("ai", "model", "model is live"),
  t("ai", "model", "model live"),
  t("ai", "model", "weights released"),
  t("ai", "app", "app is live"),
  t("ai", "app", "app live"),
  t("ai", "app", "product is live"),
  t("ai", "app", "product launch"),

  // ── AI agents ──
  t("ai-agents", "agent", "agent is live"),
  t("ai-agents", "agent", "agent live"),
  t("ai-agents", "agent", "agents live"),
  t("ai-agents", "agent", "agent live now"),
  t("ai-agents", "launch", "framework release"),
  t("ai-agents", "launch", "sdk live"),
  t("ai-agents", "launch", "agent launchpad live"),
  t("ai-agents", "token", "bonding complete"),
  t("ai-agents", "token", "graduated"),
  tr(
    "ai-agents",
    "token",
    "contract address",
    `(?:\\bca\\b|contract(?:\\s*address)?)\\s*[:\\-]?\\s*(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})`,
  ),

  // ── DeFi / DEX / lending ──
  t("defi", "vault", "vault is live"),
  t("defi", "vault", "vault live"),
  t("defi", "vault", "markets are live"),
  t("defi", "vault", "markets live"),
  t("defi", "vault", "pool is live"),
  t("defi", "vault", "pool live"),
  t("defi", "points", "points are live"),
  t("defi", "points", "points live"),
  t("defi", "points", "points program"),
  t("defi", "points", "season 1 is live"),
  t("defi", "points", "season 1 live"),
  t("defi", "stake", "staking is live"),
  t("defi", "stake", "staking live"),
  t("defi", "stake", "farming live"),
  t("dex", "trade", "trading is live"),
  t("dex", "trade", "trading live"),
  t("dex", "trade", "swap live"),
  t("dex", "trade", "swap is live"),
  t("dex", "trade", "now trading"),
  t("dex", "trade", "liquidity live"),
  t("lending-yield", "market", "market live"),
  t("lending-yield", "market", "markets live"),
  t("lending-yield", "vault", "vault live"),
  t("lending-yield", "vault", "yield live"),

  // ── DePIN ──
  t("depin", "sale", "node sale live"),
  t("depin", "sale", "node sale"),
  t("depin", "sale", "license sale"),
  t("depin", "live", "network live"),
  t("depin", "live", "rewards live"),
  t("depin", "live", "mining live"),
  t("depin", "live", "onboarding live"),
  t("depin", "live", "device onboarding"),

  // ── Launchpad ──
  t("launchpad", "sale", "ido live"),
  t("launchpad", "sale", "sale is live"),
  t("launchpad", "sale", "sale live"),
  t("launchpad", "sale", "presale live"),
  t("launchpad", "sale", "public sale"),
  t("launchpad", "sale", "fair launch"),
  t("launchpad", "sale", "bonding curve live"),

  // ── SocialFi / tools ──
  t("socialfi", "app", "app live"),
  t("socialfi", "app", "app is live"),
  t("socialfi", "app", "beta live"),
  t("socialfi", "app", "invite codes"),
  t("tools", "launch", "product launch"),
  t("tools", "launch", "bot live"),
  t("tools", "launch", "api key open"),
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Compiled = { label: string; re: RegExp; category: string };

let cache: { at: number; generic: Compiled[]; bySlug: Map<string, Compiled[]> } | null =
  null;
const TTL = 15_000;

/** Core verticals expanded in early mode when account is untagged / only alpha. */
const EARLY_EXPAND_VERTICALS = [
  "nft",
  "l1",
  "l2",
  "defi",
  "dex",
  "ai",
  "ai-agents",
  "gamefi",
  "depin",
  "launchpad",
  "socialfi",
  "tools",
  "lending-yield",
] as const;

const IGNORE_TAGS = new Set([
  "unknown",
  "other",
  "alpha",
  "noise",
  "early",
  "",
]);

function compileRule(r: {
  label: string;
  pattern: string;
  isRegex: boolean;
  category: string;
}): Compiled {
  // Multi-word phrases: flexible whitespace. Single token: word boundary.
  // Dots in phrases like mint.fun: treat as literal after escape.
  const re = r.isRegex
    ? new RegExp(r.pattern, "i")
    : r.pattern.includes(" ")
      ? new RegExp(escapeRegExp(r.pattern).replace(/\\ /g, "\\s+"), "i")
      : new RegExp(`\\b${escapeRegExp(r.pattern)}\\b`, "i");
  return { label: r.label, re, category: r.category };
}

export async function loadCompiledRules(): Promise<{
  generic: Compiled[];
  bySlug: Map<string, Compiled[]>;
}> {
  if (cache && Date.now() - cache.at < TTL) {
    return { generic: cache.generic, bySlug: cache.bySlug };
  }
  const rows = await prisma.signalRule.findMany({ where: { enabled: true } });
  const generic: Compiled[] = [];
  const bySlug = new Map<string, Compiled[]>();
  for (const r of rows) {
    try {
      const c = compileRule(r);
      if (!r.slug) generic.push(c);
      else {
        const list = bySlug.get(r.slug) ?? [];
        list.push(c);
        bySlug.set(r.slug, list);
      }
    } catch {
      console.warn(`[signal-rules] skip bad pattern id=${r.id} ${r.pattern}`);
    }
  }
  // Fallback if DB empty
  if (rows.length === 0) {
    for (const s of DEFAULT_SIGNAL_RULES) {
      try {
        const c = compileRule({
          label: s.label,
          pattern: s.pattern,
          isRegex: s.isRegex ?? false,
          category: s.category,
        });
        if (!s.slug) generic.push(c);
        else {
          const list = bySlug.get(s.slug) ?? [];
          list.push(c);
          bySlug.set(s.slug, list);
        }
      } catch {
        /* skip */
      }
    }
  }
  cache = { at: Date.now(), generic, bySlug };
  return { generic, bySlug };
}

export function invalidateSignalRuleCache(): void {
  cache = null;
}

/** Normalize tag slug list for detection. */
export function normalizeTagSlugs(
  slug?: string | string[] | null,
): string[] {
  if (slug == null) return [];
  const arr = Array.isArray(slug) ? slug : [slug];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    const s = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!s || IGNORE_TAGS.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * When lexicon misses but tweet has mint/claim/mainnet structure (links, dates,
 * field cards), emit synthetic labels so early projects still surface.
 */
export function structuralFallbackSignals(text: string): string[] {
  const t = text ?? "";
  if (!t.trim()) return [];
  const out: string[] = [];
  const hasMint = /\bmint(?:ing)?\b/i.test(t);
  const hasWl = /\b(?:\bwl\b|whitelist|allowlist|premint|gtd|gwl)\b/i.test(t);
  const hasClaim = /\b(?:claim|airdrop|eligibility)\b/i.test(t);
  const hasMainnet = /\b(?:mainnet|testnet|chain\s*id|rpc)\b/i.test(t);
  const hasTge = /\b(?:tge|token\s+generation|token\s+launch)\b/i.test(t);

  const mintLink =
    /https?:\/\/(?:www\.)?(?:opensea\.io|magiceden\.io|launchmynft\.io|tensor\.trade|blur\.io|mint\.fun|exchange\.art|formfunction\.xyz|candymachine|mint\.[^\s/]+)[^\s)]*/i.test(
      t,
    );
  const formLink =
    /https?:\/\/(?:www\.)?(?:premint\.xyz|superful\.xyz|wlist\.io|forms\.gle|docs\.google\.com\/forms|typeform\.com|guild\.xyz)[^\s)]*/i.test(
      t,
    );
  const claimLink =
    /https?:\/\/(?:www\.)?(?:claim\.[^\s/]+|airdrop\.[^\s/]+|checker\.[^\s/]+|layer3\.xyz|galxe\.com|zealy\.io)[^\s)]*/i.test(
      t,
    );
  const hasDateNearMint =
    hasMint &&
    (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i.test(
      t,
    ) ||
      /\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\b/.test(t) ||
      /\b(?:tomorrow|tonight|today)\b/i.test(t));
  const fieldCard =
    /(?:^|\n)\s*(?:•|\*|●|-)?\s*(?:mint\s*date|mint\s*price|supply|total\s*supply|chain\s*id)\s*[:\-]/im.test(
      t,
    );

  if (mintLink && hasMint) out.push("mint link");
  if (formLink && (hasWl || hasMint)) out.push("wl form link");
  if (claimLink && hasClaim) out.push("claim link");
  if (hasDateNearMint) out.push("mint schedule");
  if (fieldCard && (hasMint || hasMainnet)) out.push("field card");
  if (hasMainnet && /chain\s*id\s*[:\-]?\s*\d+/i.test(t)) out.push("mainnet card");
  if (hasTge && /https?:\/\//i.test(t)) out.push("tge link");

  return out;
}

export type DetectSignalsOpts = {
  /**
   * early — use all account tags + expand core verticals when untagged
   *   so mint-date regexes / vertical extras still fire on early projects.
   * default — generic + explicit tags only.
   */
  mode?: "default" | "early";
  /** Also run structural fallback when lexicon matches nothing (default true). */
  structuralFallback?: boolean;
};

/**
 * Detect signal keywords in a tweet.
 * Always checks generic (slug=null) rules.
 * Also checks every provided tag slug’s extras.
 * Early mode expands core verticals when the account is untagged.
 */
export async function detectSignalsWithRules(
  text: string,
  slug?: string | string[] | null,
  opts?: DetectSignalsOpts,
): Promise<string[]> {
  if (!text.trim()) return [];
  const mode = opts?.mode ?? "default";
  const useStructural = opts?.structuralFallback !== false;
  const tags = normalizeTagSlugs(slug);

  const { generic, bySlug } = await loadCompiledRules();
  const pools: Compiled[][] = [generic];

  const extraSlugs = new Set<string>(tags);
  if (mode === "early" && tags.length === 0) {
    for (const v of EARLY_EXPAND_VERTICALS) extraSlugs.add(v);
  }

  for (const s of extraSlugs) {
    const tagRules = bySlug.get(s);
    if (tagRules?.length) pools.push(tagRules);
  }

  const matched = new Set<string>();
  for (const pool of pools) {
    for (const { label, re } of pool) {
      try {
        if (re.test(text)) matched.add(label);
      } catch {
        /* bad regex */
      }
    }
  }

  if (matched.size === 0 && useStructural) {
    for (const lab of structuralFallbackSignals(text)) matched.add(lab);
  }

  return [...matched];
}

/** Legacy bare NFT tokens — too noisy; disable if still present from older seeds. */
const LEGACY_BARE_NFT_PATTERNS = new Set([
  "mint",
  "minting",
  "wl",
  "whitelist",
  "allowlist",
  "reveal",
]);

/**
 * Categories that belong on generic (all tags), not nft-only.
 * Used to promote wrongly-slugged NFT rows into shared lifecycle.
 */
const PROMOTE_TO_GENERIC_CATEGORIES = new Set([
  "mint",
  "wl",
  "mint_date",
  "mint_time",
  "mint_params",
  "tba",
  "tge",
  "launch",
  "sale",
]);

/**
 * Seed defaults when empty, or insert any missing default patterns.
 * Also:
 *  - disables legacy bare NFT tokens (mint/wl alone)
 *  - promotes high-value nft-only lifecycle rules → generic (all tags)
 *    so early untagged projects stop missing mint dates / WL open
 * Safe to call from admin “Seed defaults”.
 */
export async function seedDefaultSignalRules(): Promise<{
  inserted: number;
  disabledLegacy: number;
  promotedToGeneric: number;
  total: number;
}> {
  const existing = await prisma.signalRule.findMany({
    select: {
      id: true,
      slug: true,
      pattern: true,
      enabled: true,
      category: true,
      isRegex: true,
      label: true,
    },
  });
  const have = new Set(
    existing.map((r) => `${r.slug ?? ""}::${r.pattern.toLowerCase()}`),
  );

  const toInsert = DEFAULT_SIGNAL_RULES.filter(
    (r) => !have.has(`${r.slug ?? ""}::${r.pattern.toLowerCase()}`),
  );

  if (toInsert.length > 0) {
    await prisma.signalRule.createMany({
      data: toInsert.map((r) => ({
        slug: r.slug,
        category: r.category,
        label: r.label,
        pattern: r.pattern,
        isRegex: r.isRegex ?? false,
        enabled: true,
      })),
    });
    // Refresh have-set for promote step
    for (const r of toInsert) {
      have.add(`${r.slug ?? ""}::${r.pattern.toLowerCase()}`);
    }
  }

  // Demote legacy single-token NFT rules
  const legacyIds = existing
    .filter(
      (r) =>
        r.enabled &&
        r.slug === "nft" &&
        LEGACY_BARE_NFT_PATTERNS.has(r.pattern.toLowerCase().trim()),
    )
    .map((r) => r.id);

  let disabledLegacy = 0;
  if (legacyIds.length > 0) {
    const res = await prisma.signalRule.updateMany({
      where: { id: { in: legacyIds } },
      data: { enabled: false },
    });
    disabledLegacy = res.count;
  }

  // Promote nft-only lifecycle phrases/regex that have no generic twin → generic
  // (keeps nft row; adds generic so All tags shows them correctly + early hits them)
  let promotedToGeneric = 0;
  const promoteCandidates = existing.filter(
    (r) =>
      r.enabled &&
      r.slug === "nft" &&
      PROMOTE_TO_GENERIC_CATEGORIES.has(r.category) &&
      !LEGACY_BARE_NFT_PATTERNS.has(r.pattern.toLowerCase().trim()),
  );
  for (const r of promoteCandidates) {
    const key = `::${r.pattern.toLowerCase()}`;
    if (have.has(key)) continue;
    await prisma.signalRule.create({
      data: {
        slug: null,
        category: r.category,
        label: r.label,
        pattern: r.pattern,
        isRegex: r.isRegex,
        enabled: true,
      },
    });
    have.add(key);
    promotedToGeneric++;
  }

  if (toInsert.length > 0 || disabledLegacy > 0 || promotedToGeneric > 0) {
    invalidateSignalRuleCache();
  }

  const total = await prisma.signalRule.count();
  return {
    inserted: toInsert.length,
    disabledLegacy,
    promotedToGeneric,
    total,
  };
}
