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

function refreshSnapshot(lex: Lexicon): void {
  labelSnapshot = lex.labels;
  slugSnapshot = lex.validSlugs;
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
 * Run the keyword lexicon over arbitrary free text and return the matching tag
 * slugs. No handle logic and no `unknown` fallback — empty means "no type".
 */
export async function classifyText(text: string): Promise<string[]> {
  if (!text.trim()) return [];
  const lex = await getLexicon();
  refreshSnapshot(lex);
  const matched: string[] = [];
  for (const [slug, patterns] of lex.compiled) {
    if (patterns.some((re) => re.test(text))) matched.push(slug);
  }
  return matched;
}

/**
 * Infer project-type tag slugs for an account from its username, name, and
 * description. De-duplicated; falls back to `["unknown"]` when nothing matches.
 */
export async function classifyAccount(account: ClassifiableAccount): Promise<string[]> {
  const lex = await getLexicon();
  refreshSnapshot(lex);

  const matched = new Set<string>();
  const text = `${account.name ?? ""} ${account.description ?? ""}`;
  if (text.trim()) {
    for (const [slug, patterns] of lex.compiled) {
      if (patterns.some((re) => re.test(text))) matched.add(slug);
    }
  }
  for (const slug of tagsFromHandle(account.username, lex)) matched.add(slug);
  return matched.size > 0 ? [...matched] : [DEFAULT_SLUG];
}

/** Force a lexicon reload on the next classify (used after an admin edit). */
export function invalidateLexiconCache(): void {
  cache = null;
}
