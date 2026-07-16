// New-chain detection via JSON snapshot (user approach):
//
//   1. GET https://chainlist.org/rpcs.json  (all chains)
//   2. If no snapshot file → write full JSON (seed, no Telegram flood)
//   3. If snapshot exists → compare chainIds → alert NEW ones on TG
//   4. Overwrite snapshot with latest full list
//
// Snapshot path: data/chainlist-snapshot.json (or CHAINLIST_SNAPSHOT_PATH).
// Telegram topic: settings key alert.topic.chainlist (selectable in admin).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { getConfig } from "./appConfig.js";
import { alertTopicKey } from "./appConfig.js";
import { sendTelegramAlert, isAlertEnabled } from "../tg/sendAlert.js";
import { formatChainlistAlert } from "./formatAlert.js";

const CHAINLIST_RPCS_URL =
  process.env.CHAINLIST_RPCS_URL ?? "https://chainlist.org/rpcs.json";
const CHAINID_NETWORK_URL =
  process.env.CHAINID_NETWORK_URL ?? "https://chainid.network/chains.json";

/** Skip Telegram for testnets unless true. */
const ALERT_TESTNETS = process.env.CHAINLIST_ALERT_TESTNETS === "1";
/** Probe first RPC with eth_blockNumber (default on). */
const CHECK_RPC = process.env.CHAINLIST_CHECK_RPC !== "0";
const RPC_TIMEOUT_MS = Number(process.env.CHAINLIST_RPC_TIMEOUT_MS ?? 4_000);
const DEFAULT_SNAPSHOT = path.join(
  process.cwd(),
  "data",
  "chainlist-snapshot.json",
);
const DEFAULT_DISCOVERIES = path.join(
  process.cwd(),
  "data",
  "chainlist-discoveries.json",
);

function snapshotPath(): string {
  return process.env.CHAINLIST_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT;
}

function discoveriesPath(): string {
  return process.env.CHAINLIST_DISCOVERIES_PATH ?? DEFAULT_DISCOVERIES;
}

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

export interface ChainDiscovery extends ChainSnapshot {
  firstSeenAt: string;
  rpcLive: boolean | null;
  alerted: boolean;
}

export interface ChainlistPollResult {
  source: string;
  fetched: number;
  newChains: number;
  alerted: number;
  seeded?: boolean;
  snapshotPath?: string;
  topicId?: number | null;
  error?: string;
}

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

function parseChainlistRpcs(data: unknown): ChainSnapshot[] {
  if (!Array.isArray(data)) return [];
  const out: ChainSnapshot[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const id = c.chainId ?? c.networkId;
    if (id == null) continue;
    const chainId = String(id);
    const name = String(c.name ?? c.chain ?? `Chain ${chainId}`);
    const native = c.nativeCurrency as { symbol?: string } | undefined;
    out.push({
      chainId,
      name,
      shortName: typeof c.shortName === "string" ? c.shortName : null,
      nativeSymbol: native?.symbol ?? null,
      rpcUrl: firstHttpRpc(c.rpc),
      explorerUrl: firstExplorer(c.explorers),
      infoUrl: typeof c.infoURL === "string" ? c.infoURL : null,
      isTestnet: looksTestnet(name),
      source: "chainlist",
    });
  }
  return out;
}

function parseChainidNetwork(data: unknown): ChainSnapshot[] {
  if (!Array.isArray(data)) return [];
  const out: ChainSnapshot[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (c.chainId == null) continue;
    const chainId = String(c.chainId);
    const name = String(c.name ?? `Chain ${chainId}`);
    const native = c.nativeCurrency as { symbol?: string } | undefined;
    const isTestnet =
      c.testnet === true ||
      looksTestnet(name) ||
      (typeof c.network === "string" && /test/i.test(c.network));
    out.push({
      chainId,
      name,
      shortName: typeof c.shortName === "string" ? c.shortName : null,
      nativeSymbol: native?.symbol ?? null,
      rpcUrl: firstHttpRpc(c.rpc),
      explorerUrl: firstExplorer(c.explorers),
      infoUrl: typeof c.infoURL === "string" ? c.infoURL : null,
      isTestnet,
      source: "chainid.network",
    });
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "early-alpha-chainlist/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.json();
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
  const merged = [...newOnes, ...prev].slice(0, 200);
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
  });
  // Explicit topic wins; sendTelegramAlert also falls back to alert.topic.chainlist
  await sendTelegramAlert(
    msg,
    "MarkdownV2",
    topicId ?? undefined,
    "chainlist",
  );
}

/**
 * Poll: fetch all chains → compare JSON file → alert new → rewrite file.
 */
export async function pollChainlist(): Promise<ChainlistPollResult> {
  let source: string;
  let chains: ChainSnapshot[];
  try {
    const fetched = await fetchChainSnapshots();
    source = fetched.source;
    chains = fetched.chains;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[chainlist] fetch failed:", msg);
    return { source: "none", fetched: 0, newChains: 0, alerted: 0, error: msg };
  }

  if (chains.length === 0) {
    return {
      source,
      fetched: 0,
      newChains: 0,
      alerted: 0,
      error: "empty_catalog",
    };
  }

  const prev = await readSnapshotFile();
  const isSeed = !prev || prev.chains.length === 0;
  const known = new Set((prev?.chains ?? []).map((c) => c.chainId));
  const newcomers = isSeed
    ? []
    : chains.filter((c) => !known.has(c.chainId));

  const topicId = await getChainlistTopicId();
  let alerted = 0;
  const discoveries: ChainDiscovery[] = [];

  // Seed path: no compare alerts unless SEED_ALERTS
  if (isSeed) {
    await writeSnapshotFile(source, chains);

    console.log(
      `[chainlist] seeded snapshot ${snapshotPath()} with ${chains.length} chains (no alerts)`,
    );
    return {
      source,
      fetched: chains.length,
      newChains: 0,
      alerted: 0,
      seeded: true,
      snapshotPath: snapshotPath(),
      topicId,
    };
  }

  const allNew = chains.filter((c) => !known.has(c.chainId));

  for (const c of allNew) {
    const skipAlert = c.isTestnet && !ALERT_TESTNETS;
    const rpcLive = skipAlert ? null : await probeRpcLive(c.rpcUrl);
    let didAlert = false;
    if (!skipAlert) {
      try {
        await sendNewChainAlert(c, rpcLive, topicId);
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
    });
  }

  // Always rewrite full catalog file after compare
  await writeSnapshotFile(source, chains);
  await prependDiscoveries(discoveries);
  // Light DB mirror for newcomers only (not full catalog)
  await mirrorToDb(allNew, { seed: false }).catch(() => undefined);

  console.log(
    `[chainlist] source=${source} fetched=${chains.length} new=${allNew.length} ` +
      `alerted=${alerted} topic=${topicId ?? "default"} file=${snapshotPath()}`,
  );

  return {
    source,
    fetched: chains.length,
    newChains: allNew.length,
    alerted,
    snapshotPath: snapshotPath(),
    topicId,
  };
}

/** Optional DB mirror so admin / backup still work. */
async function mirrorToDb(
  chains: ChainSnapshot[],
  opts: { seed: boolean },
): Promise<void> {
  const now = new Date();
  for (const c of chains) {
    await prisma.knownChain.upsert({
      where: { chainId: c.chainId },
      create: {
        chainId: c.chainId,
        name: c.name,
        shortName: c.shortName,
        nativeSymbol: c.nativeSymbol,
        rpcUrl: c.rpcUrl,
        explorerUrl: c.explorerUrl,
        infoUrl: c.infoUrl,
        isTestnet: c.isTestnet,
        source: c.source,
        firstSeenAt: now,
        lastSeenAt: now,
        alertedAt: opts.seed ? null : now,
      },
      update: {
        name: c.name,
        lastSeenAt: now,
        ...(c.rpcUrl ? { rpcUrl: c.rpcUrl } : {}),
      },
    });
  }
}

/** Status for admin UI. */
export async function getChainlistStatus(): Promise<{
  snapshotPath: string;
  snapshotExists: boolean;
  snapshotUpdatedAt: string | null;
  snapshotCount: number;
  source: string | null;
  topicId: number | null;
  discoveries: ChainDiscovery[];
}> {
  const snap = await readSnapshotFile();
  const discoveries = await readDiscoveries();
  const topicId = await getChainlistTopicId();
  return {
    snapshotPath: snapshotPath(),
    snapshotExists: snap != null,
    snapshotUpdatedAt: snap?.updatedAt ?? null,
    snapshotCount: snap?.count ?? 0,
    source: snap?.source ?? null,
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
