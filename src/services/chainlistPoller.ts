// New-chain detection — two independent sources (each can be on/off):
//
//   A) rpcs.json snapshot (chainlist.org / chainid.network)
//      GET rpcs.json → compare data/chainlist-snapshot.json → alert new chainIds
//
//   B) GitHub DefiLlama/chainlist additionalChainRegistry
//      List constants/additionalChainRegistry/*.js (as added via commits like
//      https://github.com/DefiLlama/chainlist/commit/81864e1…) → compare
//      data/chainlist-github-snapshot.json → fetch + parse new files → alert
//
// Telegram topic: settings key alert.topic.chainlist
// Source toggles: chainlist.source.rpcs / chainlist.source.github (default on)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig, setConfig, alertTopicKey } from "./appConfig.js";
import { sendTelegramAlert, isAlertEnabled } from "../tg/sendAlert.js";
import { formatChainlistAlert } from "./formatAlert.js";
import { prisma } from "../db/prisma.js";

// ── Sources ──────────────────────────────────────────────────────────────────

export type ChainlistSourceId = "rpcs" | "github";

export const CHAINLIST_SOURCE_KEYS = {
  rpcs: "chainlist.source.rpcs",
  github: "chainlist.source.github",
} as const;

export interface ChainlistSourcesConfig {
  rpcs: boolean;
  github: boolean;
}

export async function getChainlistSources(): Promise<ChainlistSourcesConfig> {
  const [rpcs, github] = await Promise.all([
    getConfig<boolean>(CHAINLIST_SOURCE_KEYS.rpcs, true),
    getConfig<boolean>(CHAINLIST_SOURCE_KEYS.github, true),
  ]);
  return {
    rpcs: rpcs !== false,
    github: github !== false,
  };
}

export async function setChainlistSources(
  partial: Partial<ChainlistSourcesConfig>,
): Promise<ChainlistSourcesConfig> {
  if (partial.rpcs !== undefined) {
    await setConfig(CHAINLIST_SOURCE_KEYS.rpcs, Boolean(partial.rpcs));
  }
  if (partial.github !== undefined) {
    await setConfig(CHAINLIST_SOURCE_KEYS.github, Boolean(partial.github));
  }
  return getChainlistSources();
}

// ── URLs / paths ─────────────────────────────────────────────────────────────

const CHAINLIST_RPCS_URL =
  process.env.CHAINLIST_RPCS_URL ?? "https://chainlist.org/rpcs.json";
const CHAINID_NETWORK_URL =
  process.env.CHAINID_NETWORK_URL ?? "https://chainid.network/chains.json";

const GITHUB_REPO =
  process.env.CHAINLIST_GITHUB_REPO ?? "DefiLlama/chainlist";
const GITHUB_REGISTRY_PATH =
  process.env.CHAINLIST_GITHUB_PATH ??
  "constants/additionalChainRegistry";
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

/** Skip Telegram for testnets unless true. */
const ALERT_TESTNETS = process.env.CHAINLIST_ALERT_TESTNETS === "1";
/** Probe first RPC with eth_blockNumber (default on). */
const CHECK_RPC = process.env.CHAINLIST_CHECK_RPC !== "0";
const RPC_TIMEOUT_MS = Number(process.env.CHAINLIST_RPC_TIMEOUT_MS ?? 4_000);

const DEFAULT_SNAPSHOT = path.join(
  process.cwd(),
  "src/data",
  "chainlist-snapshot.json",
);
const DEFAULT_GITHUB_SNAPSHOT = path.join(
  process.cwd(),
  "src/data",
  "chainlist-github-snapshot.json",
);
const DEFAULT_DISCOVERIES = path.join(
  process.cwd(),
  "src/data",
  "chainlist-discoveries.json",
);

function snapshotPath(): string {
  return process.env.CHAINLIST_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT;
}

function githubSnapshotPath(): string {
  return process.env.CHAINLIST_GITHUB_SNAPSHOT_PATH ?? DEFAULT_GITHUB_SNAPSHOT;
}

function discoveriesPath(): string {
  return process.env.CHAINLIST_DISCOVERIES_PATH ?? DEFAULT_DISCOVERIES;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChainSnapshot {
  chainId: string;
  name: string;
  shortName: string | null;
  nativeSymbol: string | null;
  rpcUrl: string | null;
  explorerUrl: string | null;
  infoUrl: string | null;
  isTestnet: boolean;
  source: string;
}

export interface ChainlistFileSnapshot {
  updatedAt: string;
  source: string;
  count: number;
  /** Full list from last fetch — used for next poll compare. */
  chains: ChainSnapshot[];
}

export interface GithubRegistryFile {
  name: string;
  chainId: string;
  sha: string;
  path: string;
}

export interface GithubFileSnapshot {
  updatedAt: string;
  source: string;
  repo: string;
  registryPath: string;
  count: number;
  lastCommitSha: string | null;
  lastCommitUrl: string | null;
  lastCommitMessage: string | null;
  lastCommitAt: string | null;
  /** Known registry filenames / chainIds from last poll. */
  files: GithubRegistryFile[];
}

export interface ChainDiscovery extends ChainSnapshot {
  firstSeenAt: string;
  rpcLive: boolean | null;
  alerted: boolean;
  commitSha?: string | null;
  commitUrl?: string | null;
  githubFile?: string | null;
}

export interface SourcePollResult {
  source: string;
  enabled: boolean;
  skipped?: boolean;
  fetched: number;
  newChains: number;
  alerted: number;
  seeded?: boolean;
  snapshotPath?: string;
  lastCommitSha?: string | null;
  lastCommitUrl?: string | null;
  error?: string;
}

export interface ChainlistPollResult {
  sources: ChainlistSourcesConfig;
  topicId: number | null;
  rpcs: SourcePollResult;
  github: SourcePollResult;
  /** Aggregate */
  fetched: number;
  newChains: number;
  alerted: number;
  error?: string;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function looksTestnet(name: string): boolean {
  return /\b(test|testnet|sepolia|holesky|hoodi|goerli|devnet|sandbox|staging)\b/i.test(
    name,
  );
}

function firstHttpRpc(rpcs: unknown): string | null {
  if (!Array.isArray(rpcs)) return null;
  for (const r of rpcs) {
    if (typeof r === "string" && /^https?:\/\//i.test(r) && !r.includes("${")) {
      return r;
    }
    if (r && typeof r === "object" && "url" in r) {
      const u = (r as { url?: string }).url;
      if (typeof u === "string" && /^https?:\/\//i.test(u) && !u.includes("${")) {
        return u;
      }
    }
  }
  return null;
}

function firstExplorer(explorers: unknown): string | null {
  if (!Array.isArray(explorers) || explorers.length === 0) return null;
  const e = explorers[0] as { url?: string };
  return typeof e?.url === "string" ? e.url : null;
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "early-alpha-chainlist/1.0",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function fetchJson(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "early-alpha-chainlist/1.0",
      ...headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.json();
}

async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": "early-alpha-chainlist/1.0",
      ...headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

function chainFromRecord(
  c: Record<string, unknown>,
  source: string,
): ChainSnapshot | null {
  const id = c.chainId ?? c.networkId;
  if (id == null) return null;
  const chainId = String(id);
  const name = String(c.name ?? c.chain ?? `Chain ${chainId}`);
  const native = c.nativeCurrency as { symbol?: string } | undefined;
  const isTestnet =
    c.testnet === true ||
    looksTestnet(name) ||
    (typeof c.network === "string" && /test/i.test(c.network));
  return {
    chainId,
    name,
    shortName: typeof c.shortName === "string" ? c.shortName : null,
    nativeSymbol: native?.symbol ?? null,
    rpcUrl: firstHttpRpc(c.rpc),
    explorerUrl: firstExplorer(c.explorers),
    infoUrl: typeof c.infoURL === "string" ? c.infoURL : null,
    isTestnet,
    source,
  };
}

function parseChainlistRpcs(data: unknown): ChainSnapshot[] {
  if (!Array.isArray(data)) return [];
  const out: ChainSnapshot[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = chainFromRecord(raw as Record<string, unknown>, "chainlist");
    if (row) out.push(row);
  }
  return out;
}

function parseChainidNetwork(data: unknown): ChainSnapshot[] {
  if (!Array.isArray(data)) return [];
  const out: ChainSnapshot[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = chainFromRecord(
      raw as Record<string, unknown>,
      "chainid.network",
    );
    if (row) out.push(row);
  }
  return out;
}

/**
 * Parse DefiLlama additionalChainRegistry JS modules:
 *   export const data = { "name": "...", "chainId": 4111, ... };
 */
export function parseChainRegistryJs(
  text: string,
  source = "github:defillama/chainlist",
): ChainSnapshot | null {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const eq = cleaned.indexOf("=");
  if (eq < 0) return null;
  let body = cleaned.slice(eq + 1).trim();
  if (body.endsWith(";")) body = body.slice(0, -1).trim();
  // Strip trailing export noise; object should be first `{` … last `}`
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const jsonLike = body.slice(start, end + 1);
  try {
    const data = JSON.parse(jsonLike) as Record<string, unknown>;
    return chainFromRecord(data, source);
  } catch {
    // Rare: unquoted keys — try a minimal fix is out of scope; skip
    return null;
  }
}

/** chainid-4111.js → 4111 ; 127001.js → 127001 */
export function chainIdFromRegistryFilename(name: string): string | null {
  const base = name.replace(/\.js$/i, "");
  const m = base.match(/^(?:chainid-)?(\d+)$/i);
  return m ? m[1]! : null;
}

export async function fetchChainSnapshots(): Promise<{
  source: string;
  chains: ChainSnapshot[];
}> {
  try {
    const data = await fetchJson(CHAINLIST_RPCS_URL);
    const chains = parseChainlistRpcs(data);
    if (chains.length > 0) return { source: "chainlist", chains };
  } catch (err) {
    console.warn(
      "[chainlist] rpcs.json failed:",
      err instanceof Error ? err.message : err,
    );
  }
  const data = await fetchJson(CHAINID_NETWORK_URL);
  const chains = parseChainidNetwork(data);
  return { source: "chainid.network", chains };
}

export async function probeRpcLive(
  rpcUrl: string | null,
): Promise<boolean | null> {
  if (!rpcUrl || !CHECK_RPC) return null;
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (json.error || typeof json.result !== "string") return false;
    return true;
  } catch {
    return false;
  }
}

// ── File I/O ─────────────────────────────────────────────────────────────────

async function readSnapshotFile(): Promise<ChainlistFileSnapshot | null> {
  try {
    const raw = await readFile(snapshotPath(), "utf8");
    const parsed = JSON.parse(raw) as ChainlistFileSnapshot;
    if (!parsed || !Array.isArray(parsed.chains)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeSnapshotFile(
  source: string,
  chains: ChainSnapshot[],
): Promise<void> {
  const file = snapshotPath();
  await mkdir(path.dirname(file), { recursive: true });
  const body: ChainlistFileSnapshot = {
    updatedAt: new Date().toISOString(),
    source,
    count: chains.length,
    chains,
  };
  await writeFile(file, JSON.stringify(body, null, 0), "utf8");
}

async function readGithubSnapshot(): Promise<GithubFileSnapshot | null> {
  try {
    const raw = await readFile(githubSnapshotPath(), "utf8");
    const parsed = JSON.parse(raw) as GithubFileSnapshot;
    if (!parsed || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeGithubSnapshot(snap: Omit<GithubFileSnapshot, "updatedAt">): Promise<void> {
  const file = githubSnapshotPath();
  await mkdir(path.dirname(file), { recursive: true });
  const body: GithubFileSnapshot = {
    ...snap,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(file, JSON.stringify(body, null, 0), "utf8");
}

async function readDiscoveries(): Promise<ChainDiscovery[]> {
  try {
    const raw = await readFile(discoveriesPath(), "utf8");
    const parsed = JSON.parse(raw) as { items?: ChainDiscovery[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function prependDiscoveries(newOnes: ChainDiscovery[]): Promise<void> {
  if (newOnes.length === 0) return;
  const prev = await readDiscoveries();
  // Dedupe by chainId+source keeping newest first
  const seen = new Set<string>();
  const merged: ChainDiscovery[] = [];
  for (const d of [...newOnes, ...prev]) {
    const key = `${d.chainId}::${d.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(d);
    if (merged.length >= 200) break;
  }
  const file = discoveriesPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      { updatedAt: new Date().toISOString(), items: merged },
      null,
      2,
    ),
    "utf8",
  );
}

/** Topic for chainlist alerts: settings alert.topic.chainlist, else default. */
export async function getChainlistTopicId(): Promise<number | null> {
  const v = await getConfig<number | null>(alertTopicKey("chainlist"), null);
  if (v != null && Number.isFinite(Number(v))) return Number(v);
  return null;
}

async function sendNewChainAlert(
  chain: ChainSnapshot,
  rpcLive: boolean | null,
  topicId: number | null,
  extra?: { commitUrl?: string | null },
): Promise<void> {
  if (!(await isAlertEnabled("chainlist"))) return;
  if (chain.isTestnet && !ALERT_TESTNETS) return;

  const msg = formatChainlistAlert({
    chainId: chain.chainId,
    name: chain.name,
    shortName: chain.shortName,
    nativeSymbol: chain.nativeSymbol,
    rpcUrl: chain.rpcUrl,
    explorerUrl: chain.explorerUrl,
    infoUrl: chain.infoUrl,
    isTestnet: chain.isTestnet,
    rpcLive,
    source: chain.source,
    commitUrl: extra?.commitUrl ?? null,
  });
  await sendTelegramAlert(
    msg,
    "MarkdownV2",
    topicId ?? undefined,
    "chainlist",
  );
}

async function processNewChains(
  allNew: ChainSnapshot[],
  topicId: number | null,
  meta?: { commitSha?: string | null; commitUrl?: string | null; githubFile?: string | null },
): Promise<{ alerted: number; discoveries: ChainDiscovery[] }> {
  let alerted = 0;
  const discoveries: ChainDiscovery[] = [];

  for (const c of allNew) {
    const skipAlert = c.isTestnet && !ALERT_TESTNETS;
    const rpcLive = skipAlert ? null : await probeRpcLive(c.rpcUrl);
    let didAlert = false;
    if (!skipAlert) {
      try {
        await sendNewChainAlert(
          c,
          rpcLive,
          topicId,
          meta?.commitUrl != null ? { commitUrl: meta.commitUrl } : undefined,
        );
        didAlert = true;
        alerted += 1;
      } catch (err) {
        console.error(
          `[chainlist] alert failed for ${c.chainId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    discoveries.push({
      ...c,
      firstSeenAt: new Date().toISOString(),
      rpcLive,
      alerted: didAlert,
      commitSha: meta?.commitSha ?? null,
      commitUrl: meta?.commitUrl ?? null,
      githubFile: meta?.githubFile ?? null,
    });
  }

  return { alerted, discoveries };
}

// ── Source A: rpcs.json ──────────────────────────────────────────────────────

export async function pollRpcsSource(
  topicId: number | null,
): Promise<SourcePollResult> {
  let source: string;
  let chains: ChainSnapshot[];
  try {
    const fetched = await fetchChainSnapshots();
    source = fetched.source;
    chains = fetched.chains;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[chainlist:rpcs] fetch failed:", msg);
    return {
      source: "none",
      enabled: true,
      fetched: 0,
      newChains: 0,
      alerted: 0,
      error: msg,
    };
  }

  if (chains.length === 0) {
    return {
      source,
      enabled: true,
      fetched: 0,
      newChains: 0,
      alerted: 0,
      error: "empty_catalog",
    };
  }

  const prev = await readSnapshotFile();
  const isSeed = !prev || prev.chains.length === 0;
  const known = new Set((prev?.chains ?? []).map((c) => c.chainId));

  if (isSeed) {
    await writeSnapshotFile(source, chains);
    console.log(
      `[chainlist:rpcs] seeded snapshot ${snapshotPath()} with ${chains.length} chains (no alerts)`,
    );
    return {
      source,
      enabled: true,
      fetched: chains.length,
      newChains: 0,
      alerted: 0,
      seeded: true,
      snapshotPath: snapshotPath(),
    };
  }

  const allNew = chains.filter((c) => !known.has(c.chainId));
  const { alerted, discoveries } = await processNewChains(allNew, topicId);

  await writeSnapshotFile(source, chains);
  await prependDiscoveries(discoveries);

  console.log(
    `[chainlist:rpcs] source=${source} fetched=${chains.length} new=${allNew.length} ` +
      `alerted=${alerted} file=${snapshotPath()}`,
  );

  return {
    source,
    enabled: true,
    fetched: chains.length,
    newChains: allNew.length,
    alerted,
    snapshotPath: snapshotPath(),
  };
}

// ── Source B: GitHub DefiLlama/chainlist additionalChainRegistry ─────────────

interface GhContentItem {
  name: string;
  path: string;
  sha: string;
  type: string;
  download_url?: string | null;
}

interface GhCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { date?: string } | null;
    committer?: { date?: string } | null;
  };
}

async function listGithubRegistryFiles(): Promise<GithubRegistryFile[]> {
  const url = `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${GITHUB_REGISTRY_PATH}`;
  const data = await fetchJson(url, githubHeaders());
  if (!Array.isArray(data)) {
    throw new Error("github contents: expected directory listing array");
  }
  const out: GithubRegistryFile[] = [];
  for (const raw of data as GhContentItem[]) {
    if (!raw || raw.type !== "file" || !raw.name?.endsWith(".js")) continue;
    // skip index / non-chain modules
    if (/^index\./i.test(raw.name)) continue;
    const chainId = chainIdFromRegistryFilename(raw.name);
    if (!chainId) continue;
    out.push({
      name: raw.name,
      chainId,
      sha: raw.sha,
      path: raw.path,
    });
  }
  return out;
}

async function fetchLatestRegistryCommit(): Promise<{
  sha: string;
  url: string;
  message: string;
  at: string | null;
} | null> {
  const url =
    `${GITHUB_API}/repos/${GITHUB_REPO}/commits` +
    `?path=${encodeURIComponent(GITHUB_REGISTRY_PATH)}&per_page=1`;
  const data = await fetchJson(url, githubHeaders());
  if (!Array.isArray(data) || data.length === 0) return null;
  const c = data[0] as GhCommit;
  return {
    sha: c.sha,
    url: c.html_url,
    message: (c.commit?.message ?? "").split("\n")[0] ?? "",
    at:
      c.commit?.committer?.date ??
      c.commit?.author?.date ??
      null,
  };
}

async function fetchRegistryFileContent(fileName: string): Promise<string> {
  const rawUrl =
    `${GITHUB_RAW}/${GITHUB_REPO}/main/${GITHUB_REGISTRY_PATH}/${fileName}`;
  return fetchText(rawUrl, githubHeaders());
}

export async function pollGithubSource(
  topicId: number | null,
): Promise<SourcePollResult> {
  const sourceLabel = `github:${GITHUB_REPO}`;
  try {
    const [files, latestCommit] = await Promise.all([
      listGithubRegistryFiles(),
      fetchLatestRegistryCommit().catch(() => null),
    ]);

    if (files.length === 0) {
      return {
        source: sourceLabel,
        enabled: true,
        fetched: 0,
        newChains: 0,
        alerted: 0,
        error: "empty_registry",
        lastCommitSha: latestCommit?.sha ?? null,
        lastCommitUrl: latestCommit?.url ?? null,
      };
    }

    const prev = await readGithubSnapshot();
    const isSeed = !prev || prev.files.length === 0;
    const known = new Set((prev?.files ?? []).map((f) => f.chainId));
    // Also key by filename in case chainId parse changes
    const knownNames = new Set((prev?.files ?? []).map((f) => f.name));

    const snapBase = {
      source: sourceLabel,
      repo: GITHUB_REPO,
      registryPath: GITHUB_REGISTRY_PATH,
      count: files.length,
      lastCommitSha: latestCommit?.sha ?? prev?.lastCommitSha ?? null,
      lastCommitUrl: latestCommit?.url ?? prev?.lastCommitUrl ?? null,
      lastCommitMessage:
        latestCommit?.message ?? prev?.lastCommitMessage ?? null,
      lastCommitAt: latestCommit?.at ?? prev?.lastCommitAt ?? null,
      files,
    };

    if (isSeed) {
      await writeGithubSnapshot(snapBase);
      console.log(
        `[chainlist:github] seeded ${githubSnapshotPath()} with ${files.length} registry files (no alerts)`,
      );
      return {
        source: sourceLabel,
        enabled: true,
        fetched: files.length,
        newChains: 0,
        alerted: 0,
        seeded: true,
        snapshotPath: githubSnapshotPath(),
        lastCommitSha: snapBase.lastCommitSha,
        lastCommitUrl: snapBase.lastCommitUrl,
      };
    }

    const newFiles = files.filter(
      (f) => !known.has(f.chainId) && !knownNames.has(f.name),
    );

    const discoveries: ChainDiscovery[] = [];
    let alerted = 0;
    const chainsNew: ChainSnapshot[] = [];

    // Cap concurrent downloads
    const CONCURRENCY = 5;
    for (let i = 0; i < newFiles.length; i += CONCURRENCY) {
      const batch = newFiles.slice(i, i + CONCURRENCY);
      const parsed = await Promise.all(
        batch.map(async (f) => {
          try {
            const text = await fetchRegistryFileContent(f.name);
            const chain = parseChainRegistryJs(text, sourceLabel);
            if (chain) {
              // Prefer filename chainId if file parse disagrees
              if (chain.chainId !== f.chainId) {
                chain.chainId = f.chainId;
              }
              return { file: f, chain };
            }
            // Minimal fallback from filename only
            return {
              file: f,
              chain: {
                chainId: f.chainId,
                name: `Chain ${f.chainId}`,
                shortName: null,
                nativeSymbol: null,
                rpcUrl: null,
                explorerUrl: null,
                infoUrl: null,
                isTestnet: false,
                source: sourceLabel,
              } satisfies ChainSnapshot,
            };
          } catch (err) {
            console.warn(
              `[chainlist:github] failed to load ${f.name}:`,
              err instanceof Error ? err.message : err,
            );
            return null;
          }
        }),
      );
      for (const row of parsed) {
        if (row) chainsNew.push(row.chain);
      }
    }

    // Process alerts — attach latest registry commit as evidence link
    const meta = {
      commitSha: snapBase.lastCommitSha,
      commitUrl: snapBase.lastCommitUrl,
      githubFile: null as string | null,
    };

    for (const c of chainsNew) {
      const file = newFiles.find((f) => f.chainId === c.chainId);
      const fileMeta = {
        ...meta,
        githubFile: file
          ? `https://github.com/${GITHUB_REPO}/blob/main/${file.path}`
          : null,
      };
      const result = await processNewChains([c], topicId, fileMeta);
      alerted += result.alerted;
      discoveries.push(...result.discoveries.map((d) => ({
        ...d,
        githubFile: fileMeta.githubFile,
      })));
    }

    await writeGithubSnapshot(snapBase);
    await prependDiscoveries(discoveries);

    console.log(
      `[chainlist:github] repo=${GITHUB_REPO} files=${files.length} new=${chainsNew.length} ` +
        `alerted=${alerted} commit=${snapBase.lastCommitSha?.slice(0, 7) ?? "?"} ` +
        `file=${githubSnapshotPath()}`,
    );

    return {
      source: sourceLabel,
      enabled: true,
      fetched: files.length,
      newChains: chainsNew.length,
      alerted,
      snapshotPath: githubSnapshotPath(),
      lastCommitSha: snapBase.lastCommitSha,
      lastCommitUrl: snapBase.lastCommitUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[chainlist:github] poll failed:", msg);
    return {
      source: sourceLabel,
      enabled: true,
      fetched: 0,
      newChains: 0,
      alerted: 0,
      error: msg,
    };
  }
}

// ── Combined poll ────────────────────────────────────────────────────────────

/**
 * Poll all enabled sources: rpcs.json snapshot + GitHub additionalChainRegistry.
 * Each source is independent; toggles live in settings.
 */
export async function pollChainlist(): Promise<ChainlistPollResult> {
  const sources = await getChainlistSources();
  const topicId = await getChainlistTopicId();

  const skipped = (id: ChainlistSourceId): SourcePollResult => ({
    source: id,
    enabled: false,
    skipped: true,
    fetched: 0,
    newChains: 0,
    alerted: 0,
  });

  const [rpcs, github] = await Promise.all([
    sources.rpcs
      ? pollRpcsSource(topicId)
      : Promise.resolve(skipped("rpcs")),
    sources.github
      ? pollGithubSource(topicId)
      : Promise.resolve(skipped("github")),
  ]);

  const result: ChainlistPollResult = {
    sources,
    topicId,
    rpcs,
    github,
    fetched: (rpcs.fetched || 0) + (github.fetched || 0),
    newChains: (rpcs.newChains || 0) + (github.newChains || 0),
    alerted: (rpcs.alerted || 0) + (github.alerted || 0),
  };

  const errors = [rpcs.error, github.error].filter(Boolean);
  if (errors.length && result.newChains === 0 && result.fetched === 0) {
    result.error = errors.join("; ");
  }

  console.log(
    `[chainlist] done rpcs=${sources.rpcs ? `on new=${rpcs.newChains}` : "off"} ` +
      `github=${sources.github ? `on new=${github.newChains}` : "off"} ` +
      `alerted=${result.alerted} topic=${topicId ?? "default"}`,
  );

  return result;
}

/** Status for admin UI. */
export async function getChainlistStatus(): Promise<{
  sources: ChainlistSourcesConfig;
  snapshotPath: string;
  snapshotExists: boolean;
  snapshotUpdatedAt: string | null;
  snapshotCount: number;
  source: string | null;
  github: {
    snapshotPath: string;
    snapshotExists: boolean;
    snapshotUpdatedAt: string | null;
    snapshotCount: number;
    repo: string;
    registryPath: string;
    lastCommitSha: string | null;
    lastCommitUrl: string | null;
    lastCommitMessage: string | null;
    lastCommitAt: string | null;
  };
  topicId: number | null;
  discoveries: ChainDiscovery[];
}> {
  const [snap, ghSnap, discoveries, topicId, sources] = await Promise.all([
    readSnapshotFile(),
    readGithubSnapshot(),
    readDiscoveries(),
    getChainlistTopicId(),
    getChainlistSources(),
  ]);
  return {
    sources,
    snapshotPath: snapshotPath(),
    snapshotExists: snap != null,
    snapshotUpdatedAt: snap?.updatedAt ?? null,
    snapshotCount: snap?.count ?? 0,
    source: snap?.source ?? null,
    github: {
      snapshotPath: githubSnapshotPath(),
      snapshotExists: ghSnap != null,
      snapshotUpdatedAt: ghSnap?.updatedAt ?? null,
      snapshotCount: ghSnap?.count ?? 0,
      repo: ghSnap?.repo ?? GITHUB_REPO,
      registryPath: ghSnap?.registryPath ?? GITHUB_REGISTRY_PATH,
      lastCommitSha: ghSnap?.lastCommitSha ?? null,
      lastCommitUrl: ghSnap?.lastCommitUrl ?? null,
      lastCommitMessage: ghSnap?.lastCommitMessage ?? null,
      lastCommitAt: ghSnap?.lastCommitAt ?? null,
    },
    topicId,
    discoveries,
  };
}

export async function ensureChainSearchQueries(): Promise<{ created: number }> {
  const starters: { query: string; label: string }[] = [
    {
      label: "New chain · mainnet",
      query:
        '("mainnet is live" OR "mainnet live" OR "public mainnet") (rollup OR "layer 2" OR L2 OR appchain OR "new L1" OR "new chain") -filter:replies -filter:retweets',
    },
    {
      label: "New chain · sequencer",
      query:
        '("sequencer live" OR "chain is live" OR "genesis block" OR "block 1") (L2 OR rollup OR appchain) -filter:replies -filter:retweets',
    },
  ];

  let created = 0;
  for (const s of starters) {
    const exists = await prisma.searchQuery.findFirst({
      where: { label: s.label },
    });
    if (exists) continue;
    await prisma.searchQuery.create({
      data: {
        query: s.query,
        label: s.label,
        enabled: true,
        alertEnabled: true,
        intervalSec: 120,
      },
    });
    created += 1;
  }
  return { created };
}
