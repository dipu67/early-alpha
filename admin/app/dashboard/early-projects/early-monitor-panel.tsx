"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { TopicPicker } from "@/components/topic-picker";
import { useCan } from "@/components/role-context";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
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
  const [busy, setBusy] = useState(false);

  const cfg = stats.config;

  // Growth report one-shot topic
  const [growthTopicId, setGrowthTopicId] = useState("");

  // Detection rules
  const [maxFollowers, setMaxFollowers] = useState(String(cfg.maxFollowers));
  const [maxFollowing, setMaxFollowing] = useState(
    String(cfg.maxFollowing ?? 50_000),
  );
  const [maxAgeDays, setMaxAgeDays] = useState(
    String(cfg.maxAgeDays ?? Math.round((cfg.maxAgeMs ?? 365 * 86400_000) / 86400_000)),
  );
  const [firstSeenDays, setFirstSeenDays] = useState(
    String(cfg.firstSeenDays ?? 90),
  );
  const [includeSoftHot, setIncludeSoftHot] = useState(cfg.includeSoftHot ?? true);
  const [strictEarlyOnly, setStrictEarlyOnly] = useState(
    cfg.strictEarlyOnly ?? true,
  );

  // Topics + raw
  const [signalTopicId, setSignalTopicId] = useState(
    cfg.signalTopicId != null ? String(cfg.signalTopicId) : "",
  );
  const [rawTopicId, setRawTopicId] = useState(
    cfg.rawTopicId != null ? String(cfg.rawTopicId) : "",
  );
  const [profileChangeTopicId, setProfileChangeTopicId] = useState(
    cfg.profileChangeTopicId != null ? String(cfg.profileChangeTopicId) : "",
  );
  const [sendRawPosts, setSendRawPosts] = useState(cfg.sendRawPosts ?? false);

  // Poller / rate limit
  const [batchSize, setBatchSize] = useState(String(cfg.batchSize));
  const [maxBatches, setMaxBatches] = useState(String(cfg.maxBatches));
  const [maxTimelines, setMaxTimelines] = useState(String(cfg.maxTimelines));
  const [tweetReqBudget, setTweetReqBudget] = useState(
    String(cfg.tweetReqBudget ?? 45),
  );
  const [delayMs, setDelayMs] = useState(String(cfg.delayMs ?? 400));
  const [staleMsMin, setStaleMsMin] = useState(
    String(Math.round((cfg.staleMs ?? 55 * 60 * 1000) / 60_000)),
  );

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

  async function pollNow() {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy("/api/early-projects/poll", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const b = res.body as { jobId?: string };
      toast.success(
        b.jobId
          ? `Poll enqueued (job ${b.jobId}) — profiles now; tweets via queue`
          : "Poll enqueued",
      );
      router.refresh();
    } else {
      const b = res.body as { error?: string; message?: string } | null;
      toast.error(b?.error ?? b?.message ?? `Error ${res.status}`);
    }
  }

  async function sendGrowthReport() {
    if (!canWrite) return;
    const topic =
      growthTopicId.trim() === "" ? null : Number(growthTopicId.trim());
    if (growthTopicId.trim() !== "" && !Number.isFinite(topic)) {
      toast.error("Topic id must be a number");
      return;
    }
    setBusy(true);
    const res = await proxy("/api/early-projects/growth-report", {
      method: "POST",
      body: { topicId: topic },
    });
    setBusy(false);
    if (res.ok) {
      toast.success(
        topic != null
          ? `Growth report enqueued → topic ${topic}`
          : "Growth report enqueued",
      );
      router.refresh();
    } else {
      const b = res.body as { error?: string; message?: string } | null;
      toast.error(b?.error ?? b?.message ?? `Error ${res.status}`);
    }
  }

  function parseTopic(s: string): number | null {
    if (s.trim() === "") return null;
    const n = Number(s.trim());
    return Number.isFinite(n) ? n : NaN;
  }

  async function saveAll() {
    if (!canWrite) return;
    const body: Record<string, number | boolean | null> = {};

    const bs = Number(batchSize);
    const mb = Number(maxBatches);
    const mt = Number(maxTimelines);
    const d = Number(delayMs);
    const sm = Number(staleMsMin);
    const mf = Number(maxFollowers);
    const mfol = Number(maxFollowing);
    const mad = Number(maxAgeDays);
    const fsd = Number(firstSeenDays);
    const trb = Number(tweetReqBudget);
    const sigT = parseTopic(signalTopicId);
    const rawT = parseTopic(rawTopicId);
    const profT = parseTopic(profileChangeTopicId);

    if (!Number.isFinite(bs) || bs < 10 || bs > 100) {
      toast.error("Batch size must be 10–100");
      return;
    }
    if (!Number.isFinite(mb) || mb < 1 || mb > 50) {
      toast.error("Max batches must be 1–50");
      return;
    }
    if (!Number.isFinite(mt) || mt < 0 || mt > 500) {
      toast.error("Inline timelines must be 0–500");
      return;
    }
    if (!Number.isFinite(trb) || trb < 5 || trb > 50) {
      toast.error("Tweet budget must be 5–50 (Twitter ~50/15m)");
      return;
    }
    if (!Number.isFinite(d) || d < 0 || d > 10_000) {
      toast.error("Delay must be 0–10000 ms");
      return;
    }
    if (!Number.isFinite(sm) || sm < 1) {
      toast.error("Stale minutes must be ≥ 1");
      return;
    }
    if (!Number.isFinite(mf) || mf < 100) {
      toast.error("Max followers must be ≥ 100");
      return;
    }
    if (!Number.isFinite(mfol) || mfol < 100) {
      toast.error("Max following must be ≥ 100");
      return;
    }
    if (!Number.isFinite(mad) || mad < 7) {
      toast.error("Max account age (days) must be ≥ 7");
      return;
    }
    if (!Number.isFinite(fsd) || fsd < 1) {
      toast.error("First-seen window (days) must be ≥ 1");
      return;
    }
    if (Number.isNaN(sigT as number)) {
      toast.error("Signal topic must be a number or empty");
      return;
    }
    if (Number.isNaN(rawT as number)) {
      toast.error("Raw topic must be a number or empty");
      return;
    }
    if (Number.isNaN(profT as number)) {
      toast.error("Profile-change topic must be a number or empty");
      return;
    }

    body.batchSize = Math.floor(bs);
    body.maxBatches = Math.floor(mb);
    body.maxTimelines = Math.floor(mt);
    body.tweetReqBudget = Math.floor(trb);
    body.delayMs = Math.floor(d);
    body.staleMs = Math.floor(sm) * 60_000;
    body.maxFollowers = Math.floor(mf);
    body.maxFollowing = Math.floor(mfol);
    body.maxAgeDays = Math.floor(mad);
    body.firstSeenDays = Math.floor(fsd);
    body.includeSoftHot = includeSoftHot;
    body.strictEarlyOnly = strictEarlyOnly;
    body.signalTopicId = sigT;
    body.rawTopicId = rawT;
    body.profileChangeTopicId = profT;
    body.sendRawPosts = sendRawPosts;

    setBusy(true);
    const res = await proxy("/api/early-projects/config", {
      method: "PATCH",
      body,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Early detection rules + poller saved");
      router.refresh();
    } else {
      const b = res.body as { error?: string; message?: string } | null;
      toast.error(b?.error ?? b?.message ?? `Error ${res.status}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Pool size" value={fmtNum(stats.poolSize)} hint="Early only" />
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
          <CardTitle className="text-base">Poller · usersByIds + tweet queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Profiles: <code className="text-xs">getUsersByIds</code> ×{" "}
            {cfg.batchSize} (max {cfg.maxAccountsPerCycle}/cycle). TweetCount ↑ →{" "}
            <code className="text-xs">early-timeline</code> queue (
            <code className="text-xs">getUserTweets</code> ~{cfg.tweetReqBudget ?? 45}
            /15m). Inline cap {cfg.maxTimelines}; rest drain via worker so 1k+ pools
            don&apos;t burn the rate limit.
          </p>
          {last?.finishedAt ? (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <div className="mb-1 font-medium">
                Last run · <LocalTime iso={last.finishedAt} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                <span>checked {last.checked ?? "—"}</span>
                <span>timelines {last.timelines ?? "—"}</span>
                <span>queued {last.timelinesQueued ?? "—"}</span>
                <span>signals {last.signalAlerts ?? "—"}</span>
                <span>raw {last.rawAlerts ?? "—"}</span>
                <span>seeded {last.watermarkSeeded ?? "—"}</span>
                <span>fresh {last.freshTweets ?? "—"}</span>
                <span>noAlert {last.noAlert ?? "—"}</span>
                <span>snaps {last.snapshots ?? "—"}</span>
                <span>missing {last.missing ?? "—"}</span>
                <span>deleted {last.deleted ?? "—"}</span>
                <span>renames {last.renames ?? "—"}</span>
                <span>errors {last.errors ?? "—"}</span>
                <span>usersByIds {last.usersByIdsReqs ?? "—"}</span>
              </div>
              {last.timelines &&
              (last.signalAlerts ?? 0) === 0 &&
              (last.rawAlerts ?? 0) === 0 ? (
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                  {(last.watermarkSeeded ?? 0) > 0 &&
                  (last.watermarkSeeded ?? 0) >= (last.timelines ?? 0)
                    ? "No TG alerts: all timelines were first-time watermark seeds (avoids flooding old tweets). Alerts fire only on posts newer than the watermark on the next poll."
                    : (last.freshTweets ?? 0) === 0
                      ? "No TG alerts: no tweets newer than each account’s lastTweetId watermark (tweetCount may still tick for other reasons)."
                      : !(cfg.sendRawPosts ?? false)
                        ? "No TG alerts: fresh tweets had no signal keyword match, and “Send non-signal posts” is off."
                        : "No TG alerts: fresh tweets were already stored or filtered (score/tier)."}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No poll result yet. Run <strong>Poll now</strong> or wait for the hourly job.
            </p>
          )}
          {canWrite ? (
            <div className="flex flex-wrap items-end gap-3">
              <Button size="sm" disabled={busy} onClick={() => void pollNow()}>
                {busy ? "Working…" : "Poll now"}
              </Button>
              <div className="min-w-[12rem] flex-1 space-y-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Growth report topic
                </label>
                <TopicPicker
                  value={growthTopicId}
                  onChange={(v) => setGrowthTopicId(v)}
                  emptyLabel="Default (alert.topic.growthReport)"
                  compact
                  showMeta={false}
                  disabled={busy}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void sendGrowthReport()}
              >
                Send growth report
              </Button>
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

      {canWrite ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Early detection rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Only accounts matching these rules enter the early pool (profiles + tweet
                queue). Soft/hot hunter stages can be included; strict mode still applies
                age / followers caps to them.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Max followers" hint="Over this → leave pool">
                  <Input
                    value={maxFollowers}
                    onChange={(e) => setMaxFollowers(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Max following" hint="Mass-follow accounts out">
                  <Input
                    value={maxFollowing}
                    onChange={(e) => setMaxFollowing(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Max account age (days)" hint="Twitter createdAt">
                  <Input
                    value={maxAgeDays}
                    onChange={(e) => setMaxAgeDays(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field
                  label="First-seen window (days)"
                  hint="Recently discovered projects"
                >
                  <Input
                    value={firstSeenDays}
                    onChange={(e) => setFirstSeenDays(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeSoftHot}
                    onChange={(e) => setIncludeSoftHot(e.target.checked)}
                  />
                  Include soft / hot hunt stages
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={strictEarlyOnly}
                    onChange={(e) => setStrictEarlyOnly(e.target.checked)}
                  />
                  Strict early only (caps apply to soft/hot too)
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Telegram topics · signal, raw &amp; profile change
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Signal posts use the signal topic (or tag map / default if empty). Non-signal
                posts can stream as <strong>raw</strong> to a separate topic.{" "}
                <strong>Profile change</strong> (rename / bio) uses its own topic when set;
                otherwise Telegram → alert.topic.profileChange / default.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="Signal topic"
                  hint="Empty → Telegram signal map / default"
                >
                  <TopicPicker
                    value={signalTopicId}
                    onChange={(v) => setSignalTopicId(v)}
                    emptyLabel="Use signal routing default"
                    compact
                    showMeta={false}
                    disabled={busy}
                  />
                </Field>
                <Field
                  label="Raw (non-signal) topic"
                  hint="Only if raw posts enabled"
                >
                  <TopicPicker
                    value={rawTopicId}
                    onChange={(v) => setRawTopicId(v)}
                    emptyLabel="Fall back to signal topic"
                    compact
                    showMeta={false}
                    disabled={busy || !sendRawPosts}
                  />
                </Field>
                <Field
                  label="Profile change topic"
                  hint="Rename / bio alerts from early poll"
                >
                  <TopicPicker
                    value={profileChangeTopicId}
                    onChange={(v) => setProfileChangeTopicId(v)}
                    emptyLabel="Use profileChange alert default"
                    compact
                    showMeta={false}
                    disabled={busy}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sendRawPosts}
                  onChange={(e) => setSendRawPosts(e.target.checked)}
                />
                Send non-signal posts to Telegram (raw stream)
              </label>
              <p className="text-[11px] text-muted-foreground">
                Keyword rules live under{" "}
                <a href="/dashboard/signals" className="text-primary hover:underline">
                  Signals
                </a>
                . Early monitor always uses early detection mode + structural fallback.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Poller knobs · rate limit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Batch size (ids / getUsersByIds)" hint="Max 100">
                  <Input
                    value={batchSize}
                    onChange={(e) => setBatchSize(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Max batches / cycle">
                  <Input
                    value={maxBatches}
                    onChange={(e) => setMaxBatches(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field
                  label="Inline timelines / poll"
                  hint="Then rest → queue"
                >
                  <Input
                    value={maxTimelines}
                    onChange={(e) => setMaxTimelines(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field
                  label="getUserTweets budget / 15m"
                  hint="Twitter ~50; leave headroom"
                >
                  <Input
                    value={tweetReqBudget}
                    onChange={(e) => setTweetReqBudget(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Delay between calls (ms)">
                  <Input
                    value={delayMs}
                    onChange={(e) => setDelayMs(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Stale after (minutes)">
                  <Input
                    value={staleMsMin}
                    onChange={(e) => setStaleMsMin(e.target.value)}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </Field>
              </div>
              <Button size="sm" disabled={busy} onClick={() => void saveAll()}>
                Save all early settings
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}

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
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-400">
                        +{fmtNum(g.absGain)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(g.followersNow)}
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
              <li>Select pool by detection rules (age, followers, soft/hot).</li>
              <li>
                <code className="text-xs">getUsersByIds</code> bulk profiles (cheap).
              </li>
              <li>
                tweetCount ↑ → enqueue <code className="text-xs">early-timeline</code>{" "}
                (≤ budget / 15m for getUserTweets).
              </li>
              <li>Signals → signal topic; optional raw posts → raw topic.</li>
              <li>Metric snapshots for 7d growth board.</li>
            </ol>
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
          description="Adjust detection rules or wait for hunter/seeds to find early accounts."
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
