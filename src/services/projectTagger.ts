// Project-type tagger — a DB-backed, cached keyword + handle classifier.
//
// Given a Twitter account's name + description (+ handle), it infers which
// project-type tags apply and returns their slugs. Everything lives in the DB
// (project_tags): bio keywords, regex keywords, handle delim tokens, and handle
// suffix tokens. Editable from the admin Keywords UI; loaded through a short-TTL
// cache so edits apply within a cache cycle without a restart.
//
// Seed with `npm run tag:seed-keywords` (src/Tools/stoeKeyword.ts) on a fresh deploy.
//
// Usage:
//   const tags = await classifyAccount({ username, name, description });

import { prisma } from "../db/prisma.js";

/** Fallback slug applied when nothing else matches. */
export const DEFAULT_SLUG = "unknown";

const TTL_MS = Number(process.env.TAG_LEXICON_TTL_MS ?? 30_000);

interface Lexicon {
  validSlugs: Set<string>;
  labels: Map<string, string>;
  /** [slug, compiled matchers] for enabled tags with bio keywords. */
  compiled: [string, RegExp[]][];
  /** [slug, compiled delim patterns] for handle token matches. */
  handleDelim: [string, RegExp[]][];
  /** [slug, lowercased suffix token] for handle endsWith matches. */
  handleSuffix: [string, string][];
}

let cache: { value: Lexicon; at: number } | null = null;
let inflight: Promise<Lexicon> | null = null;

/**
 * Per-input memoization for classifyAccount / classifyText.
 * Prevents re-scanning the same (username, name, description) tuple across
 * callers — e.g. track.ts currently calls classifyAccount 3× per edge.
 * Keyed by a deterministic hash; evicted after CLASSIFY_MEMO_TTL_MS.
 */
const CLASSIFY_MEMO_TTL_MS = Number(process.env.TAG_CLASSIFY_MEMO_TTL_MS ?? 60_000);
interface MemoEntry {
  result: string[];
  at: number;
}
const classifyMemo = new Map<string, MemoEntry>();

function classifyMemoKey(account: ClassifiableAccount): string {
  return [account.username ?? "", account.name ?? "", account.description ?? ""].join("\x00");
}

function emptyLexicon(): Lexicon {
  return {
    validSlugs: new Set(),
    labels: new Map(),
    compiled: [],
    handleDelim: [],
    handleSuffix: [],
  };
}

/** Escape a plain-string keyword for safe embedding in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile a DB keyword row to a case-insensitive matcher. */
function compileKeyword(keyword: string, isRegex: boolean): RegExp {
  return isRegex
    ? new RegExp(keyword, "i")
    : new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
}

/** Compile a handle delim token: (?:^|[_\\d])token(?:[_\\d]|$). */
function compileHandleToken(token: string): RegExp {
  return new RegExp(`(?:^|[_\\d])${escapeRegExp(token)}(?:[_\\d]|$)`, "i");
}

/** Load + compile the lexicon from the DB (enabled tags only for matchers). */
async function loadFromDb(): Promise<Lexicon> {
  const tags = await prisma.projectTag.findMany();
  if (tags.length === 0) return emptyLexicon();

  const labels = new Map<string, string>();
  const validSlugs = new Set<string>();
  const compiled: [string, RegExp[]][] = [];
  const handleDelim: [string, RegExp[]][] = [];
  const handleSuffix: [string, string][] = [];

  for (const t of tags) {
    labels.set(t.slug, t.label);
    validSlugs.add(t.slug);
    if (!t.enabled) continue;

    const matchers = [
      ...t.keywords.map((k) => compileKeyword(k, false)),
      ...t.regexKeywords.map((k) => compileKeyword(k, true)),
    ];
    if (matchers.length > 0) compiled.push([t.slug, matchers]);

    if (t.handleTokens.length > 0) {
      handleDelim.push([t.slug, t.handleTokens.map(compileHandleToken)]);
    }
    for (const token of t.handleSuffixTokens) {
      const lower = token.toLowerCase();
      if (lower) handleSuffix.push([t.slug, lower]);
    }
  }
  return { validSlugs, labels, compiled, handleDelim, handleSuffix };
}

/** Get the current lexicon (cached, single-flighted). Keeps last good cache on DB error. */
async function getLexicon(): Promise<Lexicon> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const value = await loadFromDb();
      cache = { value, at: Date.now() };
      return value;
    } catch {
      const value = cache?.value ?? emptyLexicon();
      cache = { value, at: Date.now() };
      return value;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Synchronous label/slug snapshot, refreshed each time the lexicon loads. Kept
// sync because tagLabel is called all over the alert/formatting code where going
// async would be a large ripple; a slightly-stale label is harmless.
let labelSnapshot = new Map<string, string>();
let slugSnapshot = new Set<string>();
let chainSlugSnapshot = new Set<string>();

function refreshSnapshot(lex: Lexicon): void {
  labelSnapshot = lex.labels;
  slugSnapshot = lex.validSlugs;
  // Chain slugs = any tag whose label contains a known chain keyword.
  // Updated dynamically when tags are added/edited in the UI.
  const chainLabelKeywords = [
    "ethereum", "eth", "solana", "sol", "arbitrum", "arb",
    "optimism", "base", "zksync", "polygon", "matic",
    "bnb", "bsc", "avalanche", "avax", "near", "sui", "aptos",
    "cosmos", "ibc", "blast", "mode", "mantle", "linea", "scroll",
    "robinhood", "rcoin",
    "arc", "arcdao",
  ];
  chainSlugSnapshot = new Set(
    [...lex.labels.entries()]
      .filter(([, label]) =>
        chainLabelKeywords.some((kw) => label.toLowerCase().includes(kw)),
      )
      .map(([slug]) => slug),
  );
}

/** Warm the cache + snapshot at startup (optional; classify also lazy-loads). */
export async function warmLexicon(): Promise<void> {
  refreshSnapshot(await getLexicon());
}

/** Every known slug (sync snapshot; may lag the DB by up to one cache cycle). */
export const VALID_SLUGS: ReadonlySet<string> = {
  has: (s: string) => slugSnapshot.has(s),
  get size() {
    return slugSnapshot.size;
  },
  [Symbol.iterator]: () => slugSnapshot[Symbol.iterator](),
} as ReadonlySet<string>;

/** Human-readable display name for a slug (sync snapshot; falls back to the slug). */
export function tagLabel(slug: string): string {
  return labelSnapshot.get(slug) ?? slug;
}

/**
 * Map a tag slug to the canonical project category label.
 * Used by both enrichFromBio (keyword-based) and tag backfill (slug-based)
 * to ensure consistent category names across all code paths.
 */
const TAG_CATEGORY_MAP: Record<string, string> = {
  nft: "NFT",
  defi: "DeFi",
  ai: "AI",
  "ai-agents": "AI",
  gamefi: "GameFi",
  l1: "L1",
  l2: "L2",
  social: "Social",
  infra: "Infra",
  "infra-data": "Infra",
};

/** Convert a tag slug to its category label, falling back to the display label. */
export function tagSlugToCategory(slug: string): string {
  return TAG_CATEGORY_MAP[slug] ?? tagLabel(slug);
}

/**
 * Derive category labels from tag slugs, excluding chain slugs.
 * This is the unified source of truth for Project.category.
 */
export function tagsToCategories(tags: string[]): string[] {
  const categories = tags
    .filter((t) => t !== DEFAULT_SLUG && !CHAIN_SLUGS.has(t))
    .map((t) => tagSlugToCategory(t));
  const unique = [...new Set(categories)];
  return unique.length > 0 ? unique : ["Other"];
}

/** All tag slugs whose display label is a known chain (sync snapshot). */
export const CHAIN_SLUGS: ReadonlySet<string> = {
  has: (s: string) => chainSlugSnapshot.has(s),
  get size() { return chainSlugSnapshot.size; },
  [Symbol.iterator]: () => chainSlugSnapshot[Symbol.iterator](),
} as ReadonlySet<string>;
function normalizeHandle(username?: string | null): string {
  return (username ?? "").toLowerCase().replace(/^@+/, "");
}

function tagsFromHandle(username: string | null | undefined, lex: Lexicon): string[] {
  const handle = normalizeHandle(username);
  if (!handle) return [];
  const matched: string[] = [];
  for (const [slug, patterns] of lex.handleDelim) {
    if (patterns.some((re) => re.test(handle))) matched.push(slug);
  }
  for (const [slug, token] of lex.handleSuffix) {
    if (handle.endsWith(token)) matched.push(slug);
  }
  return matched;
}

export interface ClassifiableAccount {
  username?: string | null;
  name?: string | null;
  description?: string | null;
}

/**
 * Check the classify memo for a fresh result; returns undefined if missing or stale.
 */
function getMemoIfFresh(key: string): string[] | undefined {
  const hit = classifyMemo.get(key);
  if (hit && Date.now() - hit.at < CLASSIFY_MEMO_TTL_MS) return hit.result;
  classifyMemo.delete(key);
  return undefined;
}

/**
 * Run the keyword lexicon over arbitrary free text and return the matching tag
 * slugs. No handle logic and no `unknown` fallback — empty means "no type".
 * Results are memoized by the input text so repeated calls are free.
 */
export async function classifyText(text: string): Promise<string[]> {
  if (!text.trim()) return [];
  const key = `text:\x00${text}`;
  const memo = getMemoIfFresh(key);
  if (memo !== undefined) return memo;

  const lex = await getLexicon();
  refreshSnapshot(lex);
  const matched: string[] = [];
  for (const [slug, patterns] of lex.compiled) {
    if (patterns.some((re) => re.test(text))) matched.push(slug);
  }
  if (matched.length > 0) classifyMemo.set(key, { result: matched, at: Date.now() });
  return matched;
}

/**
 * Infer project-type tag slugs for an account from its username, name, and
 * description. De-duplicated; falls back to `["unknown"]` when nothing matches.
 *
 * Input-level memoization prevents redundant scans of the same account data
 * within the TTL — e.g. when a tracking loop calls classifyAccount 3× per edge.
 */
export async function classifyAccount(account: ClassifiableAccount): Promise<string[]> {
  const key = classifyMemoKey(account);
  const memo = getMemoIfFresh(key);
  if (memo !== undefined) return memo;

  const lex = await getLexicon();
  refreshSnapshot(lex);

  const matched = new Set<string>();
  // Bio + display name: keywords / regex (chain tags: ethereum, @ethereum, $ETH, …)
  const text = `${account.name ?? ""} ${account.description ?? ""}`;
  if (text.trim()) {
    for (const [slug, patterns] of lex.compiled) {
      if (patterns.some((re) => re.test(text))) matched.add(slug);
    }
  }
  // Username tokens/suffixes (e.g. @ethereum handle itself)
  for (const slug of tagsFromHandle(account.username, lex)) matched.add(slug);
  const result = matched.size > 0 ? [...matched] : [DEFAULT_SLUG];
  // Deduplicate by category label (e.g., "ai-agents" and "ai" → only keep one)
  const deduped = dedupTagsByCategory(result);
  // Remove chain slugs from tags — they belong in project.chain, not tags
  const withoutChains = deduped.filter((t) => !CHAIN_SLUGS.has(t));
  const finalResult = withoutChains.length > 0 ? withoutChains : [DEFAULT_SLUG];
  classifyMemo.set(key, { result: finalResult, at: Date.now() });
  return finalResult;
}

/**
 * Deduplicate tag slugs by their category label.
 * Keeps the first slug that maps to each unique category, removing
 * aliases like "ai-agents" when "ai" already represents the same category.
 */
export function dedupTagsByCategory(slugs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const slug of slugs) {
    if (slug === DEFAULT_SLUG) {
      result.push(slug);
      continue;
    }
    const cat = tagSlugToCategory(slug);
    if (!seen.has(cat)) {
      seen.add(cat);
      result.push(slug);
    }
  }
  return result;
}

/** Force a lexicon reload on the next classify (used after an admin edit). */
export function invalidateLexiconCache(): void {
  cache = null;
}
