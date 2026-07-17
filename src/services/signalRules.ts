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
  g("other", "sign up"),
  g("other", "register now"),
  g("other", "campaign live"),
  g("other", "points program"),

  // ── NFT tag extras (also run when scan tag is nft) ──
  t("nft", "mint", "mint"),
  t("nft", "mint", "minting"),
  t("nft", "mint", "reveal"),
  t("nft", "wl", "wl"),
  t("nft", "wl", "whitelist"),
  t("nft", "wl", "allowlist"),

  // ── NFT mint date detection (phrases + structured dates) ──
  t("nft", "mint_date", "mint date"),
  t("nft", "mint_date", "minting date"),
  t("nft", "mint_date", "official mint date"),
  t("nft", "mint_date", "confirmed mint date"),
  t("nft", "mint_date", "mint date announced"),
  t("nft", "mint_date", "mint date is"),
  t("nft", "mint_date", "mint date set"),
  t("nft", "mint_date", "mint calendar"),
  t("nft", "mint_date", "save the date"),
  t("nft", "mint_date", "mark your calendars"),
  t("nft", "mint_date", "mark your calendar"),
  t("nft", "mint_date", "drop date"),
  t("nft", "mint_date", "public mint date"),
  t("nft", "mint_date", "wl mint date"),
  t("nft", "mint_date", "whitelist mint date"),
  t("nft", "mint_date", "mint schedule"),
  t("nft", "mint_date", "minting schedule"),
  t("nft", "mint_date", "mint window"),
  t("nft", "mint_date", "mint starts on"),
  t("nft", "mint_date", "mint opens on"),
  t("nft", "mint_date", "minting on"),
  t("nft", "mint_date", "mint on"),
  t("nft", "mint_date", "we mint on"),
  t("nft", "mint_date", "mint goes live on"),
  t("nft", "mint_date", "minting goes live on"),

  // mint date: March 15 / mint date is 15 March / mint date 03/15
  tr(
    "nft",
    "mint_date",
    "mint date + calendar",
    `mint(?:ing)?\\s*dates?\\s*[:\\-–—]?\\s*(?:is\\s+|set\\s+(?:for\\s+|to\\s+)?|announced\\s+)?(?:on\\s+)?(?:(?:${RE_MONTH})\\s*${RE_DOM}|${RE_DOM}\\s*(?:of\\s+)?(?:${RE_MONTH})|${RE_NUMERIC_DATE}|(?:${RE_DOW})|tomorrow|tonight|today)`,
  ),
  // mint on March 15 / minting Friday / mint goes live April 1st
  tr(
    "nft",
    "mint_date",
    "mint on + date",
    `mint(?:ing)?\\s+(?:goes\\s+live\\s+|opens?\\s+|starts?\\s+|begins?\\s+|live\\s+)?(?:on\\s+|this\\s+)?(?:(?:${RE_MONTH})\\s*${RE_DOM}|${RE_DOM}\\s*(?:of\\s+)?(?:${RE_MONTH})|${RE_NUMERIC_DATE}|(?:${RE_DOW})|tomorrow|tonight)`,
  ),
  // public mint March 15 / free mint April 2nd
  tr(
    "nft",
    "mint_date",
    "mint + month day",
    `(?:public|free|wl|whitelist|allowlist|guaranteed)?\\s*mint(?:ing)?\\s+(?:${RE_MONTH})\\s*${RE_DOM}`,
  ),
  // 🗓️ / 📅 near mint date language (common in NFT tweets)
  tr(
    "nft",
    "mint_date",
    "mint date emoji",
    `(?:🗓️|📅|🗓).{0,40}mint|(?:mint(?:ing)?\\s*date).{0,20}(?:🗓️|📅|🗓)`,
  ),
  // mint @ 2pm / mint at 18:00 UTC with a nearby date word
  tr(
    "nft",
    "mint_date",
    "mint time slot",
    `mint(?:ing)?\\s*(?:@|at)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|utc|est|et|gmt|pst|pt)?`,
  ),

  // ── GameFi ──
  t("gamefi", "launch", "game live"),
  t("gamefi", "launch", "open beta"),
  t("gamefi", "launch", "closed beta"),
  t("gamefi", "launch", "playtest"),
  t("gamefi", "launch", "alpha test"),
  t("gamefi", "launch", "play now"),

  // ── New chain / L1–L2 (practical combo layer 1 — social) ──
  g("chain", "mainnet live"),
  g("chain", "mainnet is live"),
  g("chain", "public mainnet"),
  g("chain", "chain is live"),
  g("chain", "sequencer live"),
  g("chain", "genesis block"),
  g("chain", "new L2"),
  g("chain", "new rollup"),
  g("chain", "appchain live"),
  g("chain", "testnet to mainnet"),
  t("l2", "chain", "mainnet live"),
  t("l2", "chain", "sequencer live"),
  t("l1", "chain", "mainnet live"),
  t("l1", "chain", "genesis"),
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Compiled = { label: string; re: RegExp; category: string };

let cache: { at: number; generic: Compiled[]; bySlug: Map<string, Compiled[]> } | null =
  null;
const TTL = 15_000;

function compileRule(r: {
  label: string;
  pattern: string;
  isRegex: boolean;
  category: string;
}): Compiled {
  // Multi-word phrases: flexible whitespace. Single token: word boundary.
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
    const c = compileRule(r);
    if (!r.slug) generic.push(c);
    else {
      const list = bySlug.get(r.slug) ?? [];
      list.push(c);
      bySlug.set(r.slug, list);
    }
  }
  // Fallback if DB empty
  if (rows.length === 0) {
    for (const s of DEFAULT_SIGNAL_RULES) {
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
    }
  }
  cache = { at: Date.now(), generic, bySlug };
  return { generic, bySlug };
}

export function invalidateSignalRuleCache(): void {
  cache = null;
}

/**
 * Detect signal keywords in a tweet.
 * Always checks generic rules; also tag-specific when slug is set.
 * Returns unique labels that matched (e.g. ["mint live", "wl open"]).
 */
export async function detectSignalsWithRules(
  text: string,
  slug?: string | null,
): Promise<string[]> {
  if (!text.trim()) return [];
  const { generic, bySlug } = await loadCompiledRules();
  const pools = [generic];
  if (slug) {
    const tagRules = bySlug.get(slug);
    if (tagRules?.length) pools.push(tagRules);
  }
  const matched = new Set<string>();
  for (const pool of pools) {
    for (const { label, re } of pool) {
      if (re.test(text)) matched.add(label);
    }
  }
  return [...matched];
}

/**
 * Seed defaults when empty, or insert any missing default patterns.
 * Safe to call on every poll cycle.
 */
export async function seedDefaultSignalRules(): Promise<{
  inserted: number;
  total: number;
}> {
  const existing = await prisma.signalRule.findMany({
    select: { slug: true, pattern: true },
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
    invalidateSignalRuleCache();
  }

  const total = await prisma.signalRule.count();
  return { inserted: toInsert.length, total };
}
