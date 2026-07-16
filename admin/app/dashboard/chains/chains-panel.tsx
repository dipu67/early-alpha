"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Play, RefreshCw, Search, Save } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TopicPicker } from "@/components/topic-picker";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import {
  fmtDate,
  type ChainlistGithubStatus,
  type ChainlistSourcesConfig,
  type KnownChainItem,
} from "@/lib/types";
import Link from "next/link";

export function ChainsPanel({
  initialItems,
  initialTotal,
  initialAlerted,
  initialTopicId,
  initialSnapshot,
  initialGithub,
  initialSources,
}: {
  initialItems: KnownChainItem[];
  initialTotal: number;
  initialAlerted: number;
  initialTopicId?: number | null;
  initialSnapshot?: {
    path: string;
    exists: boolean;
    updatedAt: string | null;
    count: number;
    source: string | null;
  };
  initialGithub?: ChainlistGithubStatus;
  initialSources: ChainlistSourcesConfig;
}) {
  const canWrite = useCan("editor");
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [alerted, setAlerted] = useState(initialAlerted);
  const [busy, setBusy] = useState(false);
  const [includeTestnet, setIncludeTestnet] = useState(false);
  const [topicId, setTopicId] = useState(
    initialTopicId != null ? String(initialTopicId) : "",
  );
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [github, setGithub] = useState(initialGithub);
  const [sources, setSources] = useState(initialSources);

  async function refresh() {
    setBusy(true);
    const res = await proxy(
      `/api/chainlist?limit=50&includeTestnet=${includeTestnet ? "true" : "false"}`,
    );
    setBusy(false);
    if (res.ok) {
      const b = res.body as {
        items: KnownChainItem[];
        total: number;
        alerted: number;
        topicId?: number | null;
        snapshot?: typeof initialSnapshot;
        github?: ChainlistGithubStatus;
        sources?: ChainlistSourcesConfig;
      };
      setItems(b.items ?? []);
      setTotal(b.total ?? 0);
      setAlerted(b.alerted ?? 0);
      if (b.topicId !== undefined) {
        setTopicId(b.topicId != null ? String(b.topicId) : "");
      }
      if (b.snapshot) setSnapshot(b.snapshot);
      if (b.github) setGithub(b.github);
      if (b.sources) setSources(b.sources);
    } else toast.error("Refresh failed");
  }

  async function pollNow() {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy("/api/chainlist/poll", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const b = res.body as {
        newChains?: number;
        alerted?: number;
        topicId?: number | null;
        error?: string;
        rpcs?: {
          skipped?: boolean;
          seeded?: boolean;
          fetched?: number;
          newChains?: number;
          alerted?: number;
          error?: string;
        };
        github?: {
          skipped?: boolean;
          seeded?: boolean;
          fetched?: number;
          newChains?: number;
          alerted?: number;
          error?: string;
          lastCommitSha?: string | null;
        };
      };
      if (b.error && !(b.newChains || b.rpcs?.fetched || b.github?.fetched)) {
        toast.error(b.error);
      } else {
        const parts: string[] = [];
        if (b.rpcs?.skipped) parts.push("rpcs off");
        else if (b.rpcs?.seeded)
          parts.push(`rpcs seeded ${b.rpcs.fetched ?? 0}`);
        else if (b.rpcs)
          parts.push(
            `rpcs +${b.rpcs.newChains ?? 0} (TG ${b.rpcs.alerted ?? 0})`,
          );
        if (b.github?.skipped) parts.push("github off");
        else if (b.github?.seeded)
          parts.push(`github seeded ${b.github.fetched ?? 0}`);
        else if (b.github)
          parts.push(
            `github +${b.github.newChains ?? 0} (TG ${b.github.alerted ?? 0})`,
          );
        toast.success(
          parts.join(" · ") ||
            `Compared: new ${b.newChains ?? 0} · TG ${b.alerted ?? 0}`,
        );
      }
      await refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function saveTopic() {
    if (!canWrite) return;
    const topic = topicId.trim() === "" ? null : Number(topicId);
    if (topicId.trim() !== "" && !Number.isFinite(topic)) {
      toast.error("Topic must be a number");
      return;
    }
    setBusy(true);
    const res = await proxy("/api/chainlist/topic", {
      method: "PATCH",
      body: { topicId: topic },
    });
    setBusy(false);
    if (res.ok) {
      toast.success(
        topic == null
          ? "Chainlist alerts → default Telegram topic"
          : `Chainlist alerts → topic ${topic}`,
      );
    } else toast.error("Failed to save topic");
  }

  async function toggleSource(key: keyof ChainlistSourcesConfig, value: boolean) {
    if (!canWrite) return;
    const next = { ...sources, [key]: value };
    // Optimistic
    setSources(next);
    setBusy(true);
    const res = await proxy("/api/chainlist/sources", {
      method: "PATCH",
      body: { [key]: value },
    });
    setBusy(false);
    if (res.ok) {
      const b = res.body as { sources?: ChainlistSourcesConfig };
      if (b.sources) setSources(b.sources);
      toast.success(
        `${key === "rpcs" ? "rpcs.json" : "GitHub"} source ${value ? "enabled" : "disabled"}`,
      );
    } else {
      setSources(sources);
      toast.error("Failed to update source");
    }
  }

  async function seedSearch() {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy("/api/chainlist/seed-search", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const b = res.body as { created?: number };
      toast.success(
        b.created
          ? `Created ${b.created} Live Search queries — open Live Search`
          : "Search queries already exist",
      );
    } else toast.error("Seed failed");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b border-border/60 py-3">
          <CardTitle className="text-base">Detection sources</CardTitle>
          <CardDescription>
            Both approaches can run together on each poll. Turn either on/off
            anytime — the other keeps working.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors ${
                sources.rpcs
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/60 bg-muted/20 opacity-80"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">A · rpcs.json snapshot</span>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={sources.rpcs}
                  disabled={!canWrite || busy}
                  onChange={(e) => void toggleSource("rpcs", e.target.checked)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Fetch{" "}
                <code className="text-[10px]">chainlist.org/rpcs.json</code> →
                compare{" "}
                <code className="text-[10px]">data/chainlist-snapshot.json</code>{" "}
                → Telegram on new chainId.
              </p>
              {snapshot ? (
                <p className="text-[11px] text-muted-foreground">
                  {snapshot.exists ? (
                    <>
                      <strong className="text-foreground">{snapshot.count}</strong>{" "}
                      chains
                      {snapshot.source ? ` · ${snapshot.source}` : ""}
                      {snapshot.updatedAt
                        ? ` · ${new Date(snapshot.updatedAt).toLocaleString()}`
                        : ""}
                    </>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">
                      not seeded yet
                    </span>
                  )}
                </p>
              ) : null}
            </label>

            <label
              className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors ${
                sources.github
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/60 bg-muted/20 opacity-80"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  B · GitHub additionalChainRegistry
                </span>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={sources.github}
                  disabled={!canWrite || busy}
                  onChange={(e) => void toggleSource("github", e.target.checked)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Watch{" "}
                <a
                  href="https://github.com/DefiLlama/chainlist"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  DefiLlama/chainlist
                </a>{" "}
                for new{" "}
                <code className="text-[10px]">
                  constants/additionalChainRegistry/chainid-*.js
                </code>{" "}
                (same path as PR commits).
              </p>
              {github ? (
                <div className="space-y-0.5 text-[11px] text-muted-foreground">
                  <p>
                    {github.snapshotExists ? (
                      <>
                        <strong className="text-foreground">
                          {github.snapshotCount}
                        </strong>{" "}
                        registry files
                        {github.snapshotUpdatedAt
                          ? ` · ${new Date(github.snapshotUpdatedAt).toLocaleString()}`
                          : ""}
                      </>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        not seeded yet
                      </span>
                    )}
                  </p>
                  {github.lastCommitSha ? (
                    <p className="truncate">
                      last commit{" "}
                      {github.lastCommitUrl ? (
                        <a
                          href={github.lastCommitUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {github.lastCommitSha.slice(0, 7)}
                        </a>
                      ) : (
                        <span className="font-mono">
                          {github.lastCommitSha.slice(0, 7)}
                        </span>
                      )}
                      {github.lastCommitMessage
                        ? ` · ${github.lastCommitMessage}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Telegram topic for new chains
              </span>
              <TopicPicker
                value={topicId}
                emptyLabel="Default topic"
                compact
                showMeta={false}
                onChange={(v) => setTopicId(v)}
              />
            </div>
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void saveTopic()}
              >
                <Save className="size-3.5" />
                Save topic
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {canWrite ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || (!sources.rpcs && !sources.github)}
                  onClick={() => void pollNow()}
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Poll enabled sources
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void seedSearch()}
                >
                  <Search className="size-3.5" />
                  Seed Live Search queries
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
            <Link
              href="/dashboard/search"
              className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-muted"
            >
              Open Live Search
            </Link>
            <Link
              href="/dashboard/telegram"
              className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-muted"
            >
              Telegram settings
            </Link>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeTestnet}
                onChange={(e) => setIncludeTestnet(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              Show testnets
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void refresh()}
              className="text-xs"
            >
              Apply filter
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Badge variant={sources.rpcs ? "success" : "muted"}>
          rpcs {sources.rpcs ? "on" : "off"}
        </Badge>
        <Badge variant={sources.github ? "success" : "muted"}>
          github {sources.github ? "on" : "off"}
        </Badge>
        <Badge variant="secondary">{total} in rpcs snapshot</Badge>
        {github?.snapshotExists ? (
          <Badge variant="secondary">{github.snapshotCount} registry files</Badge>
        ) : null}
        <Badge variant="muted">{alerted} recent alerts</Badge>
        <Badge variant="muted">{items.length} shown</Badge>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 py-3">
          <CardTitle className="text-base">New chains detected</CardTitle>
          <CardDescription>
            From either detector after its snapshot was seeded. Source column
            shows rpcs/catalog vs github:DefiLlama/chainlist.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No discoveries yet"
                description='Enable at least one source, run "Poll enabled sources" twice: first seeds snapshots (no flood), later polls alert on new chainIds / registry files.'
              />
            </div>
          ) : (
            <Table className="min-w-[44rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Chain ID</TableHead>
                  <TableHead>RPC</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>First seen</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={`${c.source}-${c.chainId}-${c.firstSeenAt}`}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {c.nativeSymbol ? <span>{c.nativeSymbol}</span> : null}
                        {c.isTestnet ? (
                          <Badge variant="muted" className="text-[10px]">
                            testnet
                          </Badge>
                        ) : (
                          <Badge variant="success" className="text-[10px]">
                            mainnet
                          </Badge>
                        )}
                        {c.rpcLive === true ? (
                          <Badge variant="success" className="text-[10px]">
                            RPC ok
                          </Badge>
                        ) : null}
                        {c.rpcLive === false ? (
                          <Badge variant="destructive" className="text-[10px]">
                            RPC fail
                          </Badge>
                        ) : null}
                        {c.alerted ? (
                          <Badge variant="secondary" className="text-[10px]">
                            alerted
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.chainId}</TableCell>
                    <TableCell className="max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground">
                      {c.rpcUrl ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-[9rem] truncate text-xs text-muted-foreground">
                      {c.source}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDate(c.firstSeenAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-end gap-1">
                        <a
                          href={c.chainlistUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                        >
                          Open <ExternalLink className="size-3" />
                        </a>
                        {c.commitUrl ? (
                          <a
                            href={c.commitUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary hover:underline"
                          >
                            Commit <ExternalLink className="size-2.5" />
                          </a>
                        ) : null}
                        {c.githubFile ? (
                          <a
                            href={c.githubFile}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary hover:underline"
                          >
                            File <ExternalLink className="size-2.5" />
                          </a>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
