"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { LocalTime } from "@/components/local-time";
import { ActionButton } from "@/components/action-button";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { fmtNum, type SeedAccount, type SeedStats, type TrackingRun } from "@/lib/types";
import { Sprout } from "lucide-react";

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

export function SeedsPanel({
  initialItems,
  total,
  stats,
  suggestedCategories,
  inUseCategories,
  runs,
}: {
  initialItems: SeedAccount[];
  total: number;
  stats: SeedStats;
  suggestedCategories: string[];
  inUseCategories: string[];
  runs?: TrackingRun[];
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [username, setUsername] = useState("");
  const [category, setCategory] = useState(suggestedCategories[0] ?? "VC");
  const [label, setLabel] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>([
      ...suggestedCategories,
      ...inUseCategories,
      ...initialItems.map((s) => s.category),
    ]);
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [suggestedCategories, inUseCategories, initialItems]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return initialItems;
    return initialItems.filter(
      (s) =>
        s.username.includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.label?.toLowerCase().includes(q) ?? false),
    );
  }, [initialItems, filter]);

  async function addSeed(e: React.FormEvent) {
    e.preventDefault();
    const raw = username.trim().replace(/^@/, "");
    if (!raw) {
      toast.error("Username required");
      return;
    }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) {
      toast.error("Invalid Twitter username");
      return;
    }
    if (!category.trim()) {
      toast.error("Category required");
      return;
    }

    setBusy(true);
    try {
      const res = await proxy("/api/seeds", {
        method: "POST",
        body: {
          username: raw,
          category: category.trim(),
          label: label.trim() || null,
        },
      });
      if (res.ok) {
        const b = res.body as { username?: string; name?: string | null };
        toast.success(
          b.name
            ? `Seed @${b.username ?? raw} · ${b.name}`
            : `Seed @${b.username ?? raw} added`,
        );
        setUsername("");
        setLabel("");
        router.refresh();
      } else {
        const b = res.body as { error?: string } | null;
        const err = b?.error ?? `Error ${res.status}`;
        if (err === "already_seed") toast.error(`@${raw} is already an active seed`);
        else if (err === "invalid_username") toast.error("Invalid username");
        else if (err.startsWith("user_not_found")) toast.error(`Could not find @${raw}`);
        else toast.error(err);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Active seeds" value={stats.active} hint={`${stats.inactive} inactive`} />
        <Kpi label="Active edges" value={fmtNum(stats.edgesActive)} />
        <Kpi label="New edges 24h" value={fmtNum(stats.newEdges24h)} />
        <Kpi label="Convergence 24h" value={fmtNum(stats.convergence24h)} />
        <Kpi
          label="Missing X id"
          value={stats.missingTwitterId}
          hint={stats.missingTwitterId > 0 ? "Resolve to poll" : undefined}
        />
        <Kpi
          label="Last run"
          value={stats.lastRun?.status ?? "—"}
          hint={
            stats.lastRun
              ? `${stats.lastRun.seedsProcessed} seeds · ${stats.lastRun.newFollowEdges} edges`
              : "No runs yet"
          }
        />
      </div>

      {canWrite ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <ActionButton
            label="Track now"
            pendingLabel="Enqueueing…"
            path="/api/seeds/track"
            size="sm"
          />
          <ActionButton
            label="Full sync"
            pendingLabel="Enqueueing…"
            path="/api/seeds/track-full"
            size="sm"
            variant="outline"
            confirmTitle="Full seed sync?"
            confirm="Polls full following graphs and marks unfollows. Heavier on rate limits — run off-peak when possible."
          />
          {stats.lastRun?.startedAt ? (
            <span className="text-xs text-muted-foreground">
              Last run started <LocalTime iso={stats.lastRun.startedAt} />
            </span>
          ) : null}
        </div>
      ) : null}

      {canWrite ? (
        <form
          onSubmit={addSeed}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="flex min-w-[8rem] flex-1 flex-col gap-1">
            <label className="text-xs text-muted-foreground">Username</label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              autoComplete="off"
              disabled={busy}
            />
          </div>
          <div className="flex w-full flex-col gap-1 sm:w-40">
            <label className="text-xs text-muted-foreground">Category</label>
            <Input
              list="seed-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="VC"
              disabled={busy}
            />
            <datalist id="seed-categories">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="flex min-w-[8rem] flex-1 flex-col gap-1">
            <label className="text-xs text-muted-foreground">Label (optional)</label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. a16z partner"
              disabled={busy}
            />
          </div>
          <Button type="submit" disabled={busy || !username.trim()} className="w-full sm:w-auto">
            {busy ? "Looking up…" : "Add seed"}
          </Button>
        </form>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by handle, category, label…"
          className="max-w-sm"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length}
          {filtered.length !== total ? ` / ${total}` : ""} seeds
        </span>
      </div>

      {runs && runs.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="text-right">Seeds</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead className="text-right">Edges</TableHead>
                  <TableHead>Time</TableHead>
                  {runs.some((r) => r.error) ? <TableHead>Error</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{run.id}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.status === "success" ? "bg-green-100 text-green-700" :
                        run.status === "running" ? "bg-blue-100 text-blue-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {run.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.finishedAt
                        ? `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{run.seedsProcessed}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{run.accountsSeen}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{run.newFollowEdges}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      <LocalTime iso={run.startedAt} />
                    </TableCell>
                    {run.error ? (
                      <TableCell className="text-xs text-destructive max-w-[20rem] truncate">{run.error}</TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title="No seeds yet"
          description="Add VCs, founders, and CT accounts whose follows you want to track."
        />
      ) : (
        <div className="max-w-full rounded-lg border border-border bg-card">
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Seed</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Edges</TableHead>
                <TableHead>Last edge</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {s.profileImageUrl ? (
                        <img src={s.profileImageUrl} alt={s.username} className="size-7 rounded-full flex-shrink-0 object-cover" />
                      ) : (
                        <div className="size-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium flex-shrink-0">
                          {s.username.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <a
                          href={`https://x.com/${s.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          @{s.username}
                        </a>
                        {s.label ? (
                          <div className="text-xs text-muted-foreground">{s.label}</div>
                        ) : null}
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {s.twitterId ?? "no twitter id"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{s.category}</Badge>
                  </TableCell>
                  <TableCell>
                    {s.active ? (
                      <Badge variant="success">active</Badge>
                    ) : (
                      <Badge variant="muted">inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.edgeCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <LocalTime iso={s.lastEdgeAt} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {canWrite ? (
                        <>
                          {!s.twitterId || !s.active ? (
                            <ActionButton
                              label="Resolve"
                              pendingLabel="…"
                              size="sm"
                              path={`/api/seeds/${s.id}/resolve`}
                            />
                          ) : null}
                          {s.active ? (
                            <ActionButton
                              label="Pause"
                              pendingLabel="…"
                              method="PATCH"
                              size="sm"
                              path={`/api/seeds/${s.id}`}
                              body={{ active: false }}
                              variant="outline"
                              confirmTitle={`Pause @${s.username}?`}
                              confirm={`Stop polling @${s.username}. Edges stay; resume anytime.`}
                            />
                          ) : (
                            <ActionButton
                              label="Activate"
                              pendingLabel="…"
                              method="PATCH"
                              size="sm"
                              path={`/api/seeds/${s.id}`}
                              body={{ active: true }}
                            />
                          )}
                          <ActionButton
                            label="Remove"
                            pendingLabel="…"
                            method="DELETE"
                            size="sm"
                            path={`/api/seeds/${s.id}`}
                            variant="destructive"
                            confirmTitle={`Delete seed @${s.username}?`}
                            confirm={`Permanently delete @${s.username} and all follow edges for this seed.`}
                          />
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
