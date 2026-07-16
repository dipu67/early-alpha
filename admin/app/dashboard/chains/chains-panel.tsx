"use client";

import { useEffect, useState } from "react";
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
import { fmtDate, type KnownChainItem } from "@/lib/types";
import Link from "next/link";

export function ChainsPanel({
  initialItems,
  initialTotal,
  initialAlerted,
  initialTopicId,
  initialSnapshot,
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
      };
      setItems(b.items ?? []);
      setTotal(b.total ?? 0);
      setAlerted(b.alerted ?? 0);
      if (b.topicId !== undefined) {
        setTopicId(b.topicId != null ? String(b.topicId) : "");
      }
      if (b.snapshot) setSnapshot(b.snapshot);
    } else toast.error("Refresh failed");
  }

  useEffect(() => {
    // re-fetch when filter toggles via Apply
  }, []);

  async function pollNow() {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy("/api/chainlist/poll", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const b = res.body as {
        fetched?: number;
        newChains?: number;
        alerted?: number;
        seeded?: boolean;
        source?: string;
        snapshotPath?: string;
        topicId?: number | null;
        error?: string;
      };
      if (b.error) toast.error(b.error);
      else if (b.seeded)
        toast.success(
          `Saved full catalog (${b.fetched ?? 0} chains) to JSON snapshot — no alerts on first run`,
        );
      else
        toast.success(
          `Compared snapshot: new ${b.newChains ?? 0} · TG ${b.alerted ?? 0}` +
            (b.topicId != null ? ` · topic ${b.topicId}` : " · default topic"),
        );
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
          <CardTitle className="text-base">How it works (JSON snapshot)</CardTitle>
          <CardDescription className="space-y-2 text-sm">
            <span className="block">
              <strong>1.</strong> Fetch{" "}
              <code className="text-[11px]">https://chainlist.org/rpcs.json</code> (all chains).
            </span>
            <span className="block">
              <strong>2.</strong> First poll writes{" "}
              <code className="text-[11px]">data/chainlist-snapshot.json</code> (seed, no TG).
            </span>
            <span className="block">
              <strong>3.</strong> Next polls compare chainIds to that file → new ones alert on
              Telegram (topic below) → file is rewritten with full list.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
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

          {snapshot ? (
            <p className="text-xs text-muted-foreground">
              Snapshot:{" "}
              {snapshot.exists ? (
                <>
                  <strong className="text-foreground">{snapshot.count}</strong> chains
                  {snapshot.source ? ` · ${snapshot.source}` : ""}
                  {snapshot.updatedAt
                    ? ` · updated ${new Date(snapshot.updatedAt).toLocaleString()}`
                    : ""}
                </>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  not created yet — run Poll once
                </span>
              )}
              <span className="ml-1 font-mono text-[10px]">({snapshot.path})</span>
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {canWrite ? (
              <>
                <Button type="button" size="sm" disabled={busy} onClick={() => void pollNow()}>
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Poll Chainlist now
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
        <Badge variant="secondary">{total} in snapshot</Badge>
        <Badge variant="muted">{alerted} recent alerts</Badge>
        <Badge variant="muted">{items.length} shown</Badge>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 py-3">
          <CardTitle className="text-base">New chains detected</CardTitle>
          <CardDescription>
            Chains that appeared after the JSON snapshot was created (file compare).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No discoveries yet"
                description='Run "Poll Chainlist now" twice: first seeds the JSON file, second compares and alerts on new chainIds.'
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
                  <TableRow key={c.chainId}>
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
                    <TableCell className="text-xs text-muted-foreground">{c.source}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDate(c.firstSeenAt)}
                    </TableCell>
                    <TableCell>
                      <a
                        href={c.chainlistUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                      >
                        Open <ExternalLink className="size-3" />
                      </a>
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
