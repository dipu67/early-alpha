// Universal lifecycle signal intelligence (all verticals).
//
// After lexicon match (signalRules / postSignals):
//   1) extract structured fields (dates, links, chainId, CA, mint params, …)
//   2) map labels + text → lifecycle stages (mint, mainnet, TGE, API, …)
//   3) score urgency so bare tokens drop and live+link is critical
//
export type LifecycleStage =
  // NFT / access
  | "mint_live"
  | "mint_date"
  | "mint_time"
  | "wl_open"
  | "wl_close"
  | "mint_params"
  | "reveal"
  | "waitlist_open"
  // Chain
  | "mainnet_live"
  | "testnet_live"
  | "bridge_live"
  | "genesis"
  | "validator_open"
  // Product / AI
  | "app_live"
  | "api_live"
  | "beta_live"
  | "agent_live"
  // DeFi / markets
  | "vault_live"
  | "trading_live"
  | "points_open"
  // Token
  | "tge"
  | "claim_live"
  | "airdrop_live"
  | "listing"
  | "snapshot"
  // Infra sales
  | "node_sale"
  // Soft
  | "tba"
  | "other";

/** @deprecated Use LifecycleStage */
export type NftStage = LifecycleStage;

export type AlertTier = "drop" | "soft" | "standard" | "critical";

export interface NftPhase {
  name: string;
  rawTime?: string;
  kind?: "og" | "wl" | "public" | "fcfs" | "guaranteed" | "other";
}

export interface ExtractedFields {
  datetimeRaws: string[];
  timezone?: string;
  relative?: "today" | "tomorrow" | "tonight" | "hours" | "minutes";
  relativeAmount?: number;
  phases: NftPhase[];
  priceRaw?: string;
  supply?: number;
  maxPerWallet?: number;
  mintLinks: string[];
  formLinks: string[];
  claimLinks: string[];
  appLinks: string[];
  docsLinks: string[];
  bridgeLinks: string[];
  tradeLinks: string[];
  chainId?: string;
  rpcUrl?: string;
  explorerUrl?: string;
  contractAddress?: string;
  ticker?: string;
  hasTba: boolean;
  hasSpam: boolean;
}

/** @deprecated Use ExtractedFields */
export type NftFields = ExtractedFields;

export interface SignalImportance {
  fields: ExtractedFields;
  stages: LifecycleStage[];
  primaryStage: LifecycleStage | null;
  score: number;
  tier: AlertTier;
  displayLabels: string[];
  headline: string;
  vertical: string;
}

// ── Bare / spam ──────────────────────────────────────────────────────────

const BARE_WEAK_LABELS = new Set(
  [
    "mint",
    "minting",
    "wl",
    "whitelist",
    "allowlist",
    "reveal",
    "drop",
    "listing",
    "sign up",
    "register now",
    "snapshot",
    "launching",
    "mainnet",
    "testnet",
    "ai",
    "agent",
    "agents",
    "tge",
    "airdrop",
    "beta",
    "launch",
    "live now",
    "now live",
    "going live",
  ].map((s) => s.toLowerCase()),
);

const SPAM_RE =
  /\b(?:rt\s*\+?\s*follow|retweet\s+to\s+win|follow\s*\+\s*rt|100\s*(?:free\s*)?wl|dm\s+me\s+for|giveaway\s+wl|free\s+wl\s+spots?)\b/i;

// ── Link extractors ──────────────────────────────────────────────────────

const MINT_LINK_RE =
  /https?:\/\/(?:www\.)?(?:opensea\.io|magiceden\.io|launchmynft\.io|tensor\.trade|blur\.io|exchange\.art|formfunction\.xyz|candymachine|mint\.[^\s/]+)\/[^\s)]+/gi;

const FORM_LINK_RE =
  /https?:\/\/(?:www\.)?(?:premint\.xyz|superful\.xyz|wlist\.io|forms\.gle|docs\.google\.com\/forms|typeform\.com|guild\.xyz)[^\s)]*/gi;

const CLAIM_LINK_RE =
  /https?:\/\/(?:www\.)?(?:claim\.[^\s/]+|airdrop\.[^\s/]+|checker\.[^\s/]+|layer3\.xyz|galxe\.com|zealy\.io|questn\.com|intract\.io)[^\s)]*/gi;

const APP_LINK_RE =
  /https?:\/\/(?:www\.)?(?:app\.[^\s/]+|dashboard\.[^\s/]+)[^\s)]*/gi;

const DOCS_LINK_RE =
  /https?:\/\/(?:www\.)?(?:docs\.[^\s/]+|[^\s]*gitbook\.io|[^\s]*notion\.site)[^\s)]*/gi;

const BRIDGE_LINK_RE =
  /https?:\/\/(?:www\.)?(?:bridge\.[^\s/]+|across\.to|stargate\.finance|orbiter\.finance|superbridge\.app)[^\s)]*/gi;

const TRADE_LINK_RE =
  /https?:\/\/(?:www\.)?(?:uniswap\.org|app\.uniswap\.org|jup\.ag|jupiter\.ag|hyperliquid\.xyz|binance\.com|bybit\.com|okx\.com|raydium\.io|pump\.fun)[^\s)]*/gi;

const ANY_HTTPS_RE = /https?:\/\/[^\s)]+/gi;

// ── Field extractors ─────────────────────────────────────────────────────

const SUPPLY_RE =
  /(?:^|\n)\s*(?:•|\*|●|-)?\s*(?:total\s*)?(?:supply|collection\s*size|size)\s*[:\-]?\s*([\d,]+)/i;
const SUPPLY_INLINE_RE = /\b([\d,]{3,6})\s*(?:nfts?|supply|editions?|nodes?|licenses?)\b/i;
const PRICE_FIELD_RE =
  /(?:^|\n)\s*(?:•|\*|●|-)?\s*(?:mint\s*)?price\s*[:\-]?\s*(free|[\d.]+\s*(?:eth|sol|matic|avax|Ξ|◎)?)/i;
const PRICE_INLINE_RE = /\b(?:price|cost)\s*[:\-]?\s*(free|[\d.]+\s*(?:eth|sol))\b/i;
const FREE_MINT_RE = /\bfree\s*mint\b/i;
const MAX_WALLET_RE =
  /(?:max(?:imum)?|up\s*to)\s*(\d+)\s*(?:nfts?|mints?)?\s*(?:per\s*)?wallet|(\d+)\s*mints?\s*per\s*wallet/i;

const CHAIN_ID_RE =
  /(?:chain\s*id|chainid|chain\s*#)\s*[:\-]?\s*(\d{1,10})/i;
const RPC_RE =
  /(?:rpc(?:\s*url)?)\s*[:\-]?\s*(https?:\/\/[^\s)]+)/i;
const EXPLORER_RE =
  /(?:explorer|block\s*explorer)\s*[:\-]?\s*(https?:\/\/[^\s)]+)/i;

const CA_RE =
  /(?:\bca\b|contract(?:\s*address)?|token\s*address)\s*[:\-]?\s*(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/i;
const TICKER_RE = /\$([A-Za-z]{2,12})\b/;

const TBA_RE =
  /(?:mint\s*)?(?:date|price|time|schedule|mainnet|tge|launch)\s*[:\-]?\s*(?:tba|tbd)\b|\b(?:tba|tbd)\b/i;

const TZ_RE = /\b(utc|gmt|est|edt|et|pst|pdt|pt|cet|cest|jst|bst|gmt[+-]\d{1,2})\b/i;

const RELATIVE_HOURS_RE =
  /(?:mint(?:ing)?|claim|tge|mainnet|launch|sale|snapshot)\s+(?:in|starts?\s+in|opens?\s+in)\s+(\d+)\s*(hours?|hrs?|h)\b/i;
const RELATIVE_MINS_RE =
  /(?:mint(?:ing)?|claim|tge|mainnet|launch|sale|snapshot)\s+(?:in|starts?\s+in|opens?\s+in)\s+(\d+)\s*(minutes?|mins?|m)\b/i;

const DATETIME_PATTERNS: RegExp[] = [
  /(?:mint(?:ing)?|mainnet|tge|launch|claim|sale|snapshot)\s*dates?\s*[:\-–—]?\s*(?:is\s+|set\s+(?:for\s+|to\s+)?|announced\s+)?(?:on\s+)?([^\n.]{3,40})/gi,
  /\b((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{2,4})?)\b/gi,
  /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s*\d{2,4})?)\b/gi,
  /\b(\d{4}-\d{1,2}-\d{1,2})\b/g,
  /\b(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)\b/g,
  /(?:mint(?:ing)?|claim|tge|mainnet)\s*(?:@|at)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*(?:utc|gmt|est|et|pst|pt))?)/gi,
  /\b(\d{1,2}:\d{2}\s*(?:am|pm)?\s*(?:utc|gmt|est|et|pst|pt|cet|jst)?)\b/gi,
];

const PHASE_LINE_RE =
  /(?:^|\n)\s*(?:phase\s*[123]|og\s*mint|wl\s*mint|whitelist\s*mint|public\s*mint|holder\s*mint|fcfs|season\s*\d)[^\n]{0,80}/gi;

function uniq(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const k = x.trim();
    if (!k) continue;
    const low = k.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(k);
  }
  return out;
}

function parseIntCommas(s: string): number | undefined {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function phaseKind(line: string): NftPhase["kind"] {
  const l = line.toLowerCase();
  if (/\bog\b/.test(l)) return "og";
  if (/\bfcfs\b/.test(l)) return "fcfs";
  if (/\bguaranteed|gtd|gwl\b/.test(l)) return "guaranteed";
  if (/\bpublic\b/.test(l)) return "public";
  if (/\bwl\b|whitelist|allowlist/.test(l)) return "wl";
  return "other";
}

function matchLinks(text: string, re: RegExp): string[] {
  re.lastIndex = 0;
  return uniq(text.match(re) ?? []);
}

/** Extract structured fields for any vertical. */
export function extractSignalFields(text: string): ExtractedFields {
  const fields: ExtractedFields = {
    datetimeRaws: [],
    phases: [],
    mintLinks: matchLinks(text, MINT_LINK_RE),
    formLinks: matchLinks(text, FORM_LINK_RE),
    claimLinks: matchLinks(text, CLAIM_LINK_RE),
    appLinks: matchLinks(text, APP_LINK_RE),
    docsLinks: matchLinks(text, DOCS_LINK_RE),
    bridgeLinks: matchLinks(text, BRIDGE_LINK_RE),
    tradeLinks: matchLinks(text, TRADE_LINK_RE),
    hasTba: TBA_RE.test(text),
    hasSpam: SPAM_RE.test(text),
  };

  // Heuristic: "claim" near any https link
  if (fields.claimLinks.length === 0 && /\bclaim\b/i.test(text)) {
    const all = matchLinks(text, ANY_HTTPS_RE);
    fields.claimLinks = all.filter((u) =>
      /claim|airdrop|checker|eligibility/i.test(u),
    );
  }

  const tz = text.match(TZ_RE);
  if (tz?.[1]) fields.timezone = tz[1].toUpperCase();

  if (/\btomorrow\b/i.test(text)) fields.relative = "tomorrow";
  else if (/\btonight\b/i.test(text)) fields.relative = "tonight";
  else if (
    /\btoday\b/i.test(text) &&
    /\b(?:mint|claim|tge|mainnet|launch)\b/i.test(text)
  ) {
    fields.relative = "today";
  }

  const rh = text.match(RELATIVE_HOURS_RE);
  if (rh?.[1]) {
    fields.relative = "hours";
    fields.relativeAmount = Number(rh[1]);
  }
  const rm = text.match(RELATIVE_MINS_RE);
  if (rm?.[1]) {
    fields.relative = "minutes";
    fields.relativeAmount = Number(rm[1]);
  }

  for (const re of DATETIME_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = (m[1] ?? m[0]).trim();
      if (raw.length >= 2 && !/^(tba|tbd)$/i.test(raw)) {
        fields.datetimeRaws.push(raw);
      }
    }
  }
  fields.datetimeRaws = uniq(fields.datetimeRaws).slice(0, 8);

  const phaseLines = text.match(PHASE_LINE_RE) ?? [];
  for (const line of phaseLines) {
    const clean = line.replace(/^\s+/, "").trim();
    if (!clean) continue;
    const phase: NftPhase = { name: clean.slice(0, 100) };
    const kind = phaseKind(clean);
    if (kind) phase.kind = kind;
    fields.phases.push(phase);
  }

  const supplyM = text.match(SUPPLY_RE) ?? text.match(SUPPLY_INLINE_RE);
  if (supplyM?.[1]) {
    const n = parseIntCommas(supplyM[1]);
    if (n != null) fields.supply = n;
  }

  const priceM = text.match(PRICE_FIELD_RE) ?? text.match(PRICE_INLINE_RE);
  if (priceM?.[1]) fields.priceRaw = priceM[1].trim();
  else if (FREE_MINT_RE.test(text)) fields.priceRaw = "free";

  const maxM = text.match(MAX_WALLET_RE);
  if (maxM) {
    const n = Number(maxM[1] ?? maxM[2]);
    if (Number.isFinite(n) && n > 0 && n <= 100) fields.maxPerWallet = n;
  }

  const cid = text.match(CHAIN_ID_RE);
  if (cid?.[1]) fields.chainId = cid[1];
  const rpc = text.match(RPC_RE);
  if (rpc?.[1]) fields.rpcUrl = rpc[1];
  const exp = text.match(EXPLORER_RE);
  if (exp?.[1]) fields.explorerUrl = exp[1];

  const ca = text.match(CA_RE);
  if (ca?.[1]) fields.contractAddress = ca[1];
  const tick = text.match(TICKER_RE);
  if (tick?.[1]) fields.ticker = tick[1].toUpperCase();

  return fields;
}

/** @deprecated Use extractSignalFields */
export function extractNftFields(text: string): ExtractedFields {
  return extractSignalFields(text);
}

// ── Stages ───────────────────────────────────────────────────────────────

/** Map matched labels → lifecycle stages (all verticals). */
export function stagesFromLabels(labels: string[]): LifecycleStage[] {
  const stages = new Set<LifecycleStage>();
  for (const raw of labels) {
    const l = raw.toLowerCase();

    // Structural fallback labels from detectSignalsWithRules
    if (l === "mint link") {
      stages.add("mint_live");
      continue;
    }
    if (l === "wl form link") {
      stages.add("wl_open");
      continue;
    }
    if (l === "claim link") {
      stages.add("claim_live");
      continue;
    }
    if (l === "mint schedule" || l === "field card") {
      stages.add("mint_date");
      continue;
    }
    if (l === "mainnet card") {
      stages.add("mainnet_live");
      continue;
    }
    if (l === "tge link") {
      stages.add("tge");
      continue;
    }

    // NFT mint live
    if (
      /mint\s*is\s*live|minting\s*is\s*live|now\s*minting|minting\s*now|mint\s*live|mint\s*open|mint\s*is\s*open|public\s*mint\s*is\s*live|wl\s*mint\s*is\s*live|you\s*can\s*mint\s*now|mint\s*page\s*is\s*live|mint\s*portal\s*is\s*live|minting\s*is\s*open|mint\s*goes\s*live|minting\s*goes\s*live/.test(
        l,
      ) ||
      l === "mint live" ||
      l === "now minting"
    ) {
      stages.add("mint_live");
      continue;
    }

    if (
      /mint\s*date|minting\s*date|mint\s*schedule|minting\s*schedule|mint\s*calendar|mint\s*window|drop\s*date|save\s*the\s*date|mark\s*your\s*calendar|mint\s*timeline/.test(
        l,
      ) ||
      l.includes("mint date") ||
      l.includes("mint schedule")
    ) {
      stages.add("mint_date");
    }

    if (
      /mint\s*(?:@|at)\s*\d|mint\s*time|mint\s+in\s+\d/.test(l) ||
      l.includes("mint time")
    ) {
      stages.add("mint_time");
    }

    if (
      /\bwl\b|whitelist|allowlist|raffle|premint|gtd\s*wl|gwl|al\s*is\s*open/.test(
        l,
      ) &&
      !/mint\s*date|mint\s*live/.test(l)
    ) {
      if (/close|last\s*day|last\s*chance|ends?\s*(soon|today)/.test(l)) {
        stages.add("wl_close");
      } else {
        stages.add("wl_open");
      }
    }

    if (/waitlist/.test(l)) stages.add("waitlist_open");

    if (/reveal/.test(l)) stages.add("reveal");
    if (/tba|tbd/.test(l)) stages.add("tba");
    if (/per\s*wallet|supply|mint\s*price|free\s*mint/.test(l)) {
      stages.add("mint_params");
    }

    // Chain
    if (/mainnet\s*is\s*live|mainnet\s*live|public\s*mainnet|mainnet\s*launch/.test(l)) {
      stages.add("mainnet_live");
    }
    if (
      /testnet\s*is\s*live|public\s*testnet|devnet\s*live|faucet\s*live|incentivized\s*testnet|testnet\s*rewards/.test(
        l,
      )
    ) {
      stages.add("testnet_live");
    }
    if (
      /bridge\s*live|native\s*bridge|deposits?\s*open|withdrawals?\s*live|sequencer\s*live/.test(
        l,
      )
    ) {
      stages.add("bridge_live");
    }
    if (/genesis\s*block|genesis\s*live|network\s*launch/.test(l)) {
      stages.add("genesis");
    }
    if (
      /validator\s*application|staking\s*is\s*live|delegation\s*open|node\s*sale/.test(
        l,
      )
    ) {
      if (/node\s*sale/.test(l)) stages.add("node_sale");
      else stages.add("validator_open");
    }

    // AI / product
    if (/api\s*is\s*live|api\s*live|api\s*access|developer\s*api|inference\s*live/.test(l)) {
      stages.add("api_live");
    }
    if (/app\s*is\s*live|app\s*live|product\s*is\s*live|product\s*launch/.test(l)) {
      stages.add("app_live");
    }
    if (
      /closed\s*beta|open\s*beta|beta\s*is\s*live|beta\s*live|beta\s*access/.test(
        l,
      )
    ) {
      stages.add("beta_live");
    }
    if (
      /agent\s*is\s*live|agent\s*live|agents?\s*live|model\s*is\s*live|model\s*live|weights\s*released/.test(
        l,
      )
    ) {
      stages.add("agent_live");
    }

    // DeFi
    if (/vault\s*is\s*live|vault\s*live|markets?\s*are\s*live|markets?\s*live|pool\s*live|pool\s*is\s*live/.test(l)) {
      stages.add("vault_live");
    }
    if (
      /trading\s*is\s*live|trading\s*live|perps?\s*(?:are\s*)?live|swap\s*live|now\s*trading/.test(
        l,
      )
    ) {
      stages.add("trading_live");
    }
    if (
      /points\s*(?:are\s*)?live|points\s*program|season\s*\d+\s*(?:is\s*)?live|xp\s*live|epoch\s*live/.test(
        l,
      )
    ) {
      stages.add("points_open");
    }

    // Token
    if (
      /\btge\b|token\s*generation|token\s*launch|token\s*is\s*live|token\s*live/.test(
        l,
      )
    ) {
      stages.add("tge");
    }
    if (
      /claim\s*is\s*live|claim\s*live|claim\s*portal|claim\s*your|eligibility\s*checker|checker\s*live/.test(
        l,
      )
    ) {
      stages.add("claim_live");
    }
    if (/airdrop\s*is\s*live|airdrop\s*live/.test(l)) {
      stages.add("airdrop_live");
    }
    if (/listed\s*on|spot\s*listing|futures\s*listing|listing\s*live/.test(l)) {
      stages.add("listing");
    }
    if (/snapshot/.test(l)) stages.add("snapshot");

    // Generic access
    if (/early\s*access|campaign\s*live/.test(l)) {
      stages.add("waitlist_open");
    }
  }

  if (stages.size === 0 && labels.length > 0) stages.add("other");
  return [...stages];
}

function enrichStagesFromFields(
  stages: Set<LifecycleStage>,
  fields: ExtractedFields,
  text: string,
): void {
  if (fields.hasTba) stages.add("tba");

  if (fields.datetimeRaws.length > 0) {
    if (/\bmint/i.test(text)) stages.add("mint_date");
    if (/\b(?:mainnet|tge|launch|claim)\b/i.test(text)) stages.add("mint_date"); // schedule set
  }
  if (fields.relative === "hours" || fields.relative === "minutes") {
    if (/\bmint/i.test(text)) stages.add("mint_time");
    else stages.add("mint_time"); // generic countdown
  }
  if (fields.phases.length >= 2) stages.add("mint_date");

  // Mint marketplace link + mint language → treat as live-ish (early projects)
  if (
    fields.mintLinks.length > 0 &&
    /\bmint(?:ing)?\b/i.test(text)
  ) {
    if (
      /\bmint(?:ing)?\s+is\s+live|now\s+minting|mint\s+live\b|mint(?:ing)?\s+(?:is\s+)?open/i.test(
        text,
      )
    ) {
      stages.add("mint_live");
    } else {
      stages.add("mint_date");
    }
  }
  if (
    fields.formLinks.length > 0 ||
    (/\b(?:wl|whitelist|allowlist|waitlist)\b/i.test(text) &&
      /\b(?:open|live|apply|form|register)\b/i.test(text))
  ) {
    if (/\bwaitlist\b/i.test(text)) stages.add("waitlist_open");
    else stages.add("wl_open");
  }
  if (fields.supply != null || fields.priceRaw || fields.maxPerWallet != null) {
    stages.add("mint_params");
  }

  if (
    (fields.chainId || fields.rpcUrl || fields.explorerUrl) &&
    /\bmainnet\b/i.test(text)
  ) {
    stages.add("mainnet_live");
  }
  if (fields.bridgeLinks.length > 0) stages.add("bridge_live");
  if (fields.claimLinks.length > 0 && /\bclaim\b/i.test(text)) {
    stages.add("claim_live");
  }
  if (
    (fields.appLinks.length > 0 || fields.docsLinks.length > 0) &&
    /\b(?:api|app|docs)\b/i.test(text)
  ) {
    if (/\bapi\b/i.test(text)) stages.add("api_live");
    else stages.add("app_live");
  }
  if (fields.tradeLinks.length > 0 && /\b(?:trading|swap|perps?)\b/i.test(text)) {
    stages.add("trading_live");
  }
  if (fields.contractAddress || fields.ticker) {
    if (/\b(?:agent|live|launch|ca)\b/i.test(text)) stages.add("agent_live");
  }
}

const STAGE_WEIGHT: Record<LifecycleStage, number> = {
  mint_live: 40,
  claim_live: 42,
  airdrop_live: 38,
  tge: 40,
  mainnet_live: 42,
  bridge_live: 38,
  trading_live: 38,
  vault_live: 36,
  api_live: 38,
  app_live: 36,
  agent_live: 36,
  beta_live: 28,
  mint_time: 35,
  mint_date: 30,
  genesis: 32,
  testnet_live: 28,
  validator_open: 26,
  node_sale: 34,
  listing: 36,
  snapshot: 30,
  wl_close: 28,
  wl_open: 25,
  waitlist_open: 24,
  points_open: 26,
  mint_params: 12,
  reveal: 10,
  tba: 5,
  other: 8,
};

const STAGE_ORDER: LifecycleStage[] = [
  "claim_live",
  "mint_live",
  "mainnet_live",
  "tge",
  "airdrop_live",
  "bridge_live",
  "trading_live",
  "api_live",
  "agent_live",
  "app_live",
  "vault_live",
  "listing",
  "node_sale",
  "mint_time",
  "genesis",
  "snapshot",
  "mint_date",
  "testnet_live",
  "beta_live",
  "wl_close",
  "validator_open",
  "points_open",
  "wl_open",
  "waitlist_open",
  "mint_params",
  "reveal",
  "tba",
  "other",
];

function primaryStage(stages: LifecycleStage[]): LifecycleStage | null {
  for (const s of STAGE_ORDER) {
    if (stages.includes(s)) return s;
  }
  return null;
}

function resolveVertical(tagSlug: string | null | undefined, stages: LifecycleStage[]): string {
  const tag = (tagSlug ?? "").toLowerCase();
  if (tag && tag !== "unknown" && tag !== "other" && tag !== "alpha") return tag;
  if (stages.some((s) => s.startsWith("mint") || s === "reveal" || s === "wl_open"))
    return "nft";
  if (stages.some((s) => s === "mainnet_live" || s === "testnet_live" || s === "bridge_live" || s === "genesis"))
    return "l1";
  if (stages.some((s) => s === "api_live" || s === "agent_live" || s === "beta_live"))
    return "ai";
  if (stages.some((s) => s === "vault_live" || s === "trading_live" || s === "points_open"))
    return "defi";
  if (stages.some((s) => s === "tge" || s === "claim_live" || s === "airdrop_live" || s === "listing"))
    return "token";
  return tag || "generic";
}

function headlineFor(
  primary: LifecycleStage | null,
  tier: AlertTier,
  fields: ExtractedFields,
): string {
  if (tier === "drop") return "Filtered";
  switch (primary) {
    case "mint_live":
      return fields.mintLinks.length ? "MINT LIVE + link" : "MINT LIVE";
    case "mint_time":
      if (fields.relative === "minutes" && fields.relativeAmount != null)
        return `Action in ${fields.relativeAmount}m`;
      if (fields.relative === "hours" && fields.relativeAmount != null)
        return `Action in ${fields.relativeAmount}h`;
      return "Timed event";
    case "mint_date":
      return fields.datetimeRaws[0]
        ? `Schedule · ${fields.datetimeRaws[0]}`
        : "Schedule set";
    case "wl_open":
      return "WL / allowlist open";
    case "wl_close":
      return "WL closing";
    case "waitlist_open":
      return "Waitlist open";
    case "mainnet_live":
      return fields.chainId
        ? `MAINNET LIVE · chain ${fields.chainId}`
        : "MAINNET LIVE";
    case "testnet_live":
      return "Testnet live";
    case "bridge_live":
      return "Bridge / deposits live";
    case "genesis":
      return "Genesis / network launch";
    case "validator_open":
      return "Validator / staking open";
    case "api_live":
      return fields.docsLinks.length ? "API LIVE + docs" : "API LIVE";
    case "app_live":
      return fields.appLinks.length ? "APP LIVE + link" : "APP LIVE";
    case "beta_live":
      return "Beta open";
    case "agent_live":
      return fields.contractAddress || fields.ticker
        ? "AGENT LIVE + token"
        : "AGENT LIVE";
    case "vault_live":
      return "Vault / markets live";
    case "trading_live":
      return "Trading live";
    case "points_open":
      return "Points / season live";
    case "tge":
      return "TGE / token launch";
    case "claim_live":
      return fields.claimLinks.length ? "CLAIM LIVE + portal" : "CLAIM LIVE";
    case "airdrop_live":
      return "Airdrop live";
    case "listing":
      return "Exchange listing";
    case "snapshot":
      return fields.datetimeRaws[0]
        ? `Snapshot · ${fields.datetimeRaws[0]}`
        : "Snapshot";
    case "node_sale":
      return "Node / license sale";
    case "reveal":
      return "Reveal";
    case "tba":
      return "TBA / incomplete";
    case "mint_params":
      return "Mint / sale details";
    default:
      return "Signal";
  }
}

function hasStructure(fields: ExtractedFields): boolean {
  return (
    fields.datetimeRaws.length > 0 ||
    fields.mintLinks.length > 0 ||
    fields.formLinks.length > 0 ||
    fields.claimLinks.length > 0 ||
    fields.appLinks.length > 0 ||
    fields.docsLinks.length > 0 ||
    fields.bridgeLinks.length > 0 ||
    fields.tradeLinks.length > 0 ||
    fields.phases.length > 0 ||
    fields.supply != null ||
    fields.priceRaw != null ||
    fields.maxPerWallet != null ||
    fields.relative != null ||
    fields.chainId != null ||
    fields.rpcUrl != null ||
    fields.contractAddress != null ||
    fields.ticker != null
  );
}

/**
 * Score a matched post for any vertical.
 * Bare weak labels without structure are dropped; live + actionable link is critical.
 */
export function evaluateSignalImportance(opts: {
  text: string;
  signals: string[];
  tagSlug?: string | null;
  isOfficialAuthor?: boolean;
}): SignalImportance {
  const text = opts.text ?? "";
  const signals = opts.signals.filter(Boolean);
  const fields = extractSignalFields(text);
  const tag = (opts.tagSlug ?? "").toLowerCase();

  const stageSet = new Set<LifecycleStage>(stagesFromLabels(signals));
  enrichStagesFromFields(stageSet, fields, text);
  const stages = STAGE_ORDER.filter((s) => stageSet.has(s));
  const primary = primaryStage(stages);
  const vertical = resolveVertical(tag, stages);

  let score = 0;
  if (stages.length > 0) {
    score += Math.max(...stages.map((s) => STAGE_WEIGHT[s] ?? 8));
  } else if (signals.length > 0) {
    score += 8;
  }

  if (fields.datetimeRaws.length > 0) score += 12;
  if (fields.relative === "minutes") score += 18;
  else if (fields.relative === "hours") score += 15;
  else if (fields.relative === "tomorrow" || fields.relative === "tonight")
    score += 10;
  else if (fields.relative === "today") score += 12;

  if (fields.mintLinks.length > 0) score += 12;
  if (fields.claimLinks.length > 0) score += 14;
  if (fields.appLinks.length > 0) score += 10;
  if (fields.docsLinks.length > 0) score += 10;
  if (fields.bridgeLinks.length > 0) score += 12;
  if (fields.tradeLinks.length > 0) score += 10;
  if (fields.formLinks.length > 0) score += 8;
  if (fields.chainId) score += 12;
  if (fields.rpcUrl) score += 8;
  if (fields.explorerUrl) score += 6;
  if (fields.contractAddress) score += 12;
  if (fields.ticker) score += 6;
  if (fields.supply != null && fields.priceRaw) score += 10;
  else if (fields.supply != null || fields.priceRaw) score += 5;
  if (fields.maxPerWallet != null) score += 4;
  if (fields.phases.length >= 2) score += 10;
  if (fields.timezone) score += 3;

  if (opts.isOfficialAuthor) score += 15;

  // Vertical fit: tag matches resolved vertical
  if (tag && tag === vertical) score += 5;

  const liveStages: LifecycleStage[] = [
    "mint_live",
    "claim_live",
    "mainnet_live",
    "tge",
    "api_live",
    "app_live",
    "agent_live",
    "trading_live",
    "vault_live",
    "bridge_live",
    "airdrop_live",
  ];
  const hasLive = stages.some((s) => liveStages.includes(s));

  if (fields.hasTba && !hasLive && !fields.mintLinks.length && !fields.claimLinks.length) {
    score -= 18;
  }
  if (fields.hasSpam) score -= 30;

  const meaningful = signals.filter(
    (s) => !BARE_WEAK_LABELS.has(s.toLowerCase()),
  );
  const onlyBare = signals.length > 0 && meaningful.length === 0;
  const structured = hasStructure(fields);

  if (onlyBare && !structured) score -= 20;
  if (onlyBare && !structured) score = Math.min(score, 10);

  let tier: AlertTier;
  if (fields.hasSpam && score < 40) tier = "drop";
  else if (score < 15) tier = "drop";
  else if (score < 30) tier = "soft";
  else if (
    score >= 55 ||
    hasLive ||
    fields.relative === "minutes"
  ) {
    tier = "critical";
  } else tier = "standard";

  // Actionable live combos → always critical
  if (stages.includes("mint_live") && fields.mintLinks.length > 0) {
    tier = "critical";
    score = Math.max(score, 70);
  }
  if (stages.includes("claim_live") && fields.claimLinks.length > 0) {
    tier = "critical";
    score = Math.max(score, 72);
  }
  if (
    stages.includes("mainnet_live") &&
    (fields.chainId || fields.rpcUrl || fields.explorerUrl)
  ) {
    tier = "critical";
    score = Math.max(score, 75);
  }
  if (
    (stages.includes("api_live") || stages.includes("app_live")) &&
    (fields.docsLinks.length > 0 || fields.appLinks.length > 0)
  ) {
    tier = "critical";
    score = Math.max(score, 70);
  }
  if (
    stages.includes("agent_live") &&
    (fields.contractAddress || fields.ticker)
  ) {
    tier = "critical";
    score = Math.max(score, 68);
  }

  const displayLabels = uniq([
    ...signals,
    ...(primary ? [`stage:${primary}`] : []),
    `tier:${tier}`,
    `score:${Math.round(score)}`,
    `vert:${vertical}`,
  ]);

  return {
    fields,
    stages,
    primaryStage: primary,
    score: Math.round(score * 10) / 10,
    tier,
    displayLabels,
    headline: headlineFor(primary, tier, fields),
    vertical,
  };
}

export function shouldPersistSignal(
  imp: SignalImportance,
  opts?: { allowSoft?: boolean },
): boolean {
  if (imp.tier === "drop") return false;
  if (imp.tier === "soft" && opts?.allowSoft === false) return false;
  return true;
}

export function shouldTelegramSignal(
  imp: SignalImportance,
  opts?: { telegramSoft?: boolean },
): boolean {
  if (imp.tier === "drop") return false;
  if (imp.tier === "soft") return opts?.telegramSoft !== false;
  return true;
}

export type AlertImportanceView = {
  tier: "soft" | "standard" | "critical";
  score: number;
  headline: string;
  stages: string[];
  fields: {
    datetimeRaws: string[];
    timezone?: string;
    relative?: string;
    relativeAmount?: number;
    priceRaw?: string;
    supply?: number;
    maxPerWallet?: number;
    mintLinks: string[];
    formLinks: string[];
    claimLinks?: string[];
    appLinks?: string[];
    docsLinks?: string[];
    bridgeLinks?: string[];
    tradeLinks?: string[];
    chainId?: string;
    rpcUrl?: string;
    explorerUrl?: string;
    contractAddress?: string;
    ticker?: string;
    hasTba: boolean;
    phases: { name: string }[];
  };
  vertical?: string;
};

export function toAlertImportanceView(
  imp: SignalImportance,
): AlertImportanceView | undefined {
  if (imp.tier === "drop") return undefined;
  const f = imp.fields;
  const fields: AlertImportanceView["fields"] = {
    datetimeRaws: f.datetimeRaws,
    mintLinks: f.mintLinks,
    formLinks: f.formLinks,
    hasTba: f.hasTba,
    phases: f.phases.map((p) => ({ name: p.name })),
  };
  if (f.timezone) fields.timezone = f.timezone;
  if (f.relative) fields.relative = f.relative;
  if (f.relativeAmount != null) fields.relativeAmount = f.relativeAmount;
  if (f.priceRaw) fields.priceRaw = f.priceRaw;
  if (f.supply != null) fields.supply = f.supply;
  if (f.maxPerWallet != null) fields.maxPerWallet = f.maxPerWallet;
  if (f.claimLinks.length) fields.claimLinks = f.claimLinks;
  if (f.appLinks.length) fields.appLinks = f.appLinks;
  if (f.docsLinks.length) fields.docsLinks = f.docsLinks;
  if (f.bridgeLinks.length) fields.bridgeLinks = f.bridgeLinks;
  if (f.tradeLinks.length) fields.tradeLinks = f.tradeLinks;
  if (f.chainId) fields.chainId = f.chainId;
  if (f.rpcUrl) fields.rpcUrl = f.rpcUrl;
  if (f.explorerUrl) fields.explorerUrl = f.explorerUrl;
  if (f.contractAddress) fields.contractAddress = f.contractAddress;
  if (f.ticker) fields.ticker = f.ticker;

  return {
    tier: imp.tier,
    score: imp.score,
    headline: imp.headline,
    stages: imp.stages,
    fields,
    vertical: imp.vertical,
  };
}
