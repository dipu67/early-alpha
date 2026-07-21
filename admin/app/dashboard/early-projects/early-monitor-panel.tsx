"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCan } from "@/components/role-context";
import {
  fmtNum,
  type EarlyProjectRow,
  type EarlyProjectStats,
  type GrowthBoardRow,
} from "@/lib/types";
import { Activity } from "lucide-react";

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
        {hint ? (
          <div className="text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function stageBadge(stage: string) {
  if (stage === "hot") return <Badge variant="default">{stage}</Badge>;
  if (stage === "soft") return <Badge variant="success">{stage}</Badge>;
  if (stage === "skip" || stage === "taken")
    return <Badge variant="muted">{stage}</Badge>;
  return <Badge variant="secondary">{stage}</Badge>;
}

export function EarlyMonitorPanel({
  stats,
  initialItems,
  total,
  growth,
  growthDays,
}: {
  stats: EarlyProjectStats;
  initialItems: EarlyProjectRow[];
  total: number;
  growth: GrowthBoardRow[];
  growthDays: number;
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [filter, setFilter] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);

  const filtered = useMemo(() => {
    let rows = initialItems;
    if (staleOnly) rows = rows.filter((r) => r.dueForPoll);
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.username.includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        r.huntStage.includes(q),
    );
  }, [initialItems, filter, staleOnly]);

  const last = stats.lastPoll;
  const cfg = stats.config;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Pool size" value={fmtNum(stats.poolSize)} hint="In early set" />
        <Kpi label="Due now" value={fmtNum(stats.dueNow)} hint="Stale for poll" />
        <Kpi label="Polled 24h" value={fmtNum(stats.polled24h)} />
        <Kpi
          label="Hot / soft"
          value={`${stats.hot} / ${stats.soft}`}
          hint="Hunt stages"
        />
        <Kpi label="Renames 7d" value={fmtNum(stats.renames7d)} />
        <Kpi label="Snapshots 7d" value={fmtNum(stats.snapshots7d)} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Poller (usersByIds)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Every {cfg.pollEveryLabel}: batch{" "}
            <code className="text-xs">{cfg.batchSize}</code> via{" "}
            <code className="text-xs">getUsersByIds</code> (max{" "}
            {cfg.maxAccountsPerCycle}/cycle). tweetCount ↑ → getUserTweets (max{" "}
            {cfg.maxTimelines}). Max followers {fmtNum(cfg.maxFollowers)}.
          </p>
          {last?.finishedAt ? (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <div className="mb-1 font-medium">
                Last run · <LocalTime iso={last.finishedAt} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                <span>checked {last.checked ?? "—"}</span>
                <span>renames {last.renames ?? "—"}</span>
                <span>bio {last.bioChanges ?? "—"}</span>
                <span>timelines {last.timelines ?? "—"}</span>
                <span>signals {last.signalAlerts ?? "—"}</span>
                <span>snaps {last.snapshots ?? "—"}</span>
                <span>jumps {last.followerJumps ?? "—"}</span>
                <span>errors {last.errors ?? "—"}</span>
                <span>usersByIds {last.usersByIdsReqs ?? "—"}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No poll result stored yet. Run <strong>Poll now</strong> or wait for
              the hourly scheduler.
            </p>
          )}
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton
                label="Poll now"
                pendingLabel="Enqueueing…"
                path="/api/early-projects/poll"
                size="sm"
                onDone={() => router.refresh()}
              />
              <ActionButton
                label="Send growth report"
                pendingLabel="Enqueueing…"
                path="/api/early-projects/growth-report"
                size="sm"
                variant="outline"
                confirmTitle="Send weekly growth report?"
                confirm="Computes top growers and posts to Telegram (growthReport alert type)."
                onDone={() => router.refresh()}
              />
            </div>
          ) : null}
          {stats.lastGrowthReport?.finishedAt ? (
            <p className="text-xs text-muted-foreground">
              Last growth report:{" "}
              {stats.lastGrowthReport.sent
                ? `sent ${stats.lastGrowthReport.count ?? 0} rows`
                : "no growers / disabled"}{" "}
              · <LocalTime iso={stats.lastGrowthReport.finishedAt} />
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Top growth ({growthDays}d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {growth.length === 0 ? (
              <EmptyState
                title="No growth data yet"
                description="Need metric snapshots from polls. Run polls for a few days."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Gain</TableHead>
                    <TableHead className="text-right">Now</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {growth.map((g, i) => (
                    <TableRow key={g.accountId}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {i + 1}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`https://x.com/${g.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          @{g.username}
                        </a>
                        <div className="text-[10px] text-muted-foreground">
                          {g.huntStage}
                          {g.tags.filter((t) => t !== "unknown").length
                            ? ` · ${g.tags
                                .filter((t) => t !== "unknown")
                                .slice(0, 2)
                                .join(",")}`
                            : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-400">
                        +{fmtNum(g.absGain)}
                        <div className="text-[10px] text-muted-foreground">
                          {g.pctGain >= 10
                            ? `${g.pctGain.toFixed(0)}%`
                            : `${g.pctGain.toFixed(1)}%`}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(g.followersNow)}
                        <div className="text-[10px] text-muted-foreground">
                          from {fmtNum(g.followersBefore)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1 pl-4">
              <li>Select early accounts (soft/hot, recent, or &lt; max followers).</li>
              <li>
                <code className="text-xs">getUsersByIds</code> × 100 — cheap bulk
                profile pull.
              </li>
              <li>Detect rename, bio change, follower jump, tweetCount ↑.</li>
              <li>
                On new tweets only: fetch timeline → signal rules → Telegram.
              </li>
              <li>Store metric snapshots for 7d growth ranking.</li>
            </ol>
            <p className="text-xs">
              Different from <strong>User Monitor</strong> (manual VIP, faster). This
              covers the automatic early pool.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter handle, tag, stage…"
            className="max-w-xs"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={staleOnly}
              onChange={(e) => setStaleOnly(e.target.checked)}
            />
            Due for poll only
          </label>
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length}
          {filtered.length !== total ? ` / ${total}` : ""} in pool view
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No early projects in pool"
          description="Detect projects via seeds / hunter first. They appear here when still early."
        />
      ) : (
        <div className="max-w-full rounded-lg border border-border bg-card">
          <Table className="min-w-[52rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Followers</TableHead>
                <TableHead className="text-right">Δ detect</TableHead>
                <TableHead className="text-right">Tweets</TableHead>
                <TableHead>Last poll</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <a
                      href={`https://x.com/${r.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      @{r.username}
                    </a>
                    {r.previousUsername ? (
                      <div className="text-[10px] text-muted-foreground">
                        was @{r.previousUsername}
                      </div>
                    ) : null}
                    <div className="text-[10px] text-muted-foreground">
                      {r.tags
                        .filter((t) => t !== "unknown")
                        .slice(0, 4)
                        .join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell>{stageBadge(r.huntStage)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.followersCount != null ? fmtNum(r.followersCount) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.growthFromDetect != null ? (
                      <span
                        className={
                          r.growthFromDetect > 0
                            ? "text-emerald-400"
                            : r.growthFromDetect < 0
                              ? "text-red-400"
                              : ""
                        }
                      >
                        {r.growthFromDetect > 0 ? "+" : ""}
                        {fmtNum(r.growthFromDetect)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.tweetCount ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <LocalTime iso={r.lastProfilePolledAt} />
                  </TableCell>
                  <TableCell>
                    {r.dueForPoll ? (
                      <Badge variant="secondary">due</Badge>
                    ) : (
                      <Badge variant="muted">fresh</Badge>
                    )}
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
