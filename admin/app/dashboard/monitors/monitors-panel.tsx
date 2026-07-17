"use client";

import { useCallback, useState } from "react";
import {
  Plus,
  Radar,
  RefreshCw,
  Play,
  Trash2,
  Power,
  ExternalLink,
  Loader2,
  SkipForward,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TopicPicker } from "@/components/topic-picker";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import {
  fmtDate,
  type ProjectMonitorItem,
  type ProjectMonitorTagRule,
  type ProjectTag,
} from "@/lib/types";
import { cn } from "@/lib/cn";

const INTERVAL_PRESETS = [
  { sec: 300, label: "5 min" },
  { sec: 900, label: "15 min" },
  { sec: 1800, label: "30 min" },
  { sec: 3600, label: "1 hour" },
  { sec: 7200, label: "2 hours" },
  { sec: 21_600, label: "6 hours" },
];

function formatInterval(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

export function MonitorsPanel({
  initialItems,
  initialRules = [],
  tags = [],
}: {
  initialItems: ProjectMonitorItem[];
  initialRules?: ProjectMonitorTagRule[];
  tags?: ProjectTag[];
}) {
  const canWrite = useCan("editor");
  const [items, setItems] = useState(initialItems);
  const [rules, setRules] = useState(initialRules);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [alertMode, setAlertMode] = useState<"all" | "signals">("all");
  const [manualTopic, setManualTopic] = useState("");
  const [manualInterval, setManualInterval] = useState("300");
  const [pendingDelete, setPendingDelete] = useState<ProjectMonitorItem | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  // Tag enroll form
  const [tagSlug, setTagSlug] = useState(tags[0]?.slug ?? "nft");
  const [tagInterval, setTagInterval] = useState("3600");
  const [tagTopic, setTagTopic] = useState("");
  const [tagAlertMode, setTagAlertMode] = useState<"all" | "signals">("all");
  const [tagMax, setTagMax] = useState("1000");

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [mRes, rRes] = await Promise.all([
        proxy("/api/monitors"),
        proxy("/api/monitors/tag-rules"),
      ]);
      if (mRes.ok) {
        const body = mRes.body as { items: ProjectMonitorItem[] };
        setItems(body.items ?? []);
      }
      if (rRes.ok) {
        const body = rRes.body as { items: ProjectMonitorTagRule[] };
        setRules(body.items ?? []);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const raw = username.trim().replace(/^@/, "");
    if (!raw) {
      toast.error("Username required");
      return;
    }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) {
      toast.error("Invalid username");
      return;
    }
    setBusy(true);
    try {
      const res = await proxy("/api/monitors", {
        method: "POST",
        body: {
          username: raw,
          alertMode,
          source: "manual",
          intervalSec: Math.max(60, Number(manualInterval) || 300),
          topicId: manualTopic === "" ? null : Number(manualTopic),
        },
      });
      if (res.ok) {
        toast.success(`Monitoring @${(res.body as ProjectMonitorItem).username ?? raw}`);
        setUsername("");
        await refresh();
      } else {
        const b = res.body as { error?: string } | null;
        const err = b?.error ?? `Error ${res.status}`;
        if (err.startsWith("user_not_found")) toast.error(`Could not find @${raw}`);
        else toast.error(err);
      }
    } finally {
      setBusy(false);
    }
  }

  async function enrollByTag(e: React.FormEvent) {
    e.preventDefault();
    if (!tagSlug.trim()) {
      toast.error("Pick a tag");
      return;
    }
    setBusy(true);
    try {
      const res = await proxy("/api/monitors/enroll-by-tag", {
        method: "POST",
        body: {
          tagSlug: tagSlug.trim().toLowerCase(),
          createRule: true,
          enabled: true,
          intervalSec: Math.max(60, Number(tagInterval) || 3600),
          topicId: tagTopic === "" ? null : Number(tagTopic),
          alertMode: tagAlertMode,
          maxProjects: Math.max(1, Number(tagMax) || 1000),
        },
      });
      if (res.ok) {
        const b = res.body as {
          scanned?: number;
          enrolled?: number;
          updated?: number;
          tagSlug?: string;
        };
        toast.success(
          `Tag “${b.tagSlug}”: scanned ${b.scanned ?? 0} · +${b.enrolled ?? 0} new · ${b.updated ?? 0} updated`,
        );
        await refresh();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? `Error ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: ProjectMonitorTagRule) {
    setBusy(true);
    try {
      const res = await proxy("/api/monitors/tag-rules", {
        method: "POST",
        body: { tagSlug: rule.tagSlug, enabled: !rule.enabled },
      });
      if (res.ok) {
        toast.success(rule.enabled ? "Rule paused" : "Rule enabled");
        await refresh();
      } else toast.error("Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(id: string) {
    setBusy(true);
    try {
      const res = await proxy(`/api/monitors/tag-rules/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Rule deleted (monitors kept)");
        await refresh();
      } else toast.error("Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    try {
      const res = await proxy(`/api/monitors/${id}`, { method: "PATCH", body });
      if (res.ok) {
        if (okMsg) toast.success(okMsg);
        await refresh();
      } else toast.error("Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function pollOne(id: string, handle: string) {
    setBusy(true);
    try {
      const res = await proxy(`/api/monitors/${id}/poll`, { method: "POST", body: {} });
      if (res.ok) {
        const r = res.body as {
          fetched?: number;
          fresh?: number;
          alerted?: number;
          seeded?: boolean;
          error?: string;
        };
        if (r.error) toast.error(r.error);
        else if (r.seeded) toast.success(`@${handle} watermark seeded`);
        else
          toast.success(
            `@${handle}: ${r.fresh ?? 0} new · ${r.alerted ?? 0} alerted`,
          );
        await refresh();
      } else toast.error("Poll failed");
    } finally {
      setBusy(false);
    }
  }

  async function pollAll() {
    setBusy(true);
    try {
      const res = await proxy("/api/monitors/poll-all", { method: "POST", body: {} });
      if (res.ok) toast.success("Poll job enqueued");
      else toast.error("Failed to enqueue");
    } finally {
      setBusy(false);
    }
  }

  /** After downtime: set last record to current head — no backlog alerts. */
  async function skipBacklog(id: string, handle: string) {
    setBusy(true);
    try {
      const res = await proxy(`/api/monitors/${id}/skip-backlog`, {
        method: "POST",
        body: {},
      });
      if (res.ok) {
        const r = res.body as { seeded?: boolean; skippedPoll?: boolean; error?: string };
        if (r.error) toast.error(r.error);
        else if (r.skippedPoll)
          toast.success(`@${handle}: last record cleared (paused — resume to re-seed)`);
        else if (r.seeded)
          toast.success(`@${handle}: last record set to now (backlog skipped)`);
        else toast.success(`@${handle}: last record updated`);
        await refresh();
      } else toast.error("Skip backlog failed");
    } finally {
      setBusy(false);
    }
  }

  async function skipAllBacklogs() {
    setBusy(true);
    try {
      const res = await proxy("/api/monitors/skip-all-backlogs", {
        method: "POST",
        body: {},
      });
      if (res.ok) {
        const r = res.body as { cleared?: number };
        toast.success(
          `Cleared last record on ${r.cleared ?? items.length} monitors — re-seeding now`,
        );
        await refresh();
      } else toast.error("Skip all failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const res = await proxy(`/api/monitors/${pendingDelete.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`Removed @${pendingDelete.username}`);
        setPendingDelete(null);
        await refresh();
      } else toast.error("Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteAll() {
    setBusy(true);
    try {
      const res = await proxy("/api/monitors", { method: "DELETE" });
      if (res.ok) {
        const body = res.body as { deleted?: number };
        toast.success(`Removed ${body.deleted ?? items.length} monitor(s)`);
        setItems([]);
        setDeleteAllOpen(false);
      } else toast.error("Delete all failed");
    } finally {
      setBusy(false);
    }
  }

  const active = items.filter((i) => i.isActive).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{active} active</Badge>
        <Badge variant="muted">{items.length} total</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            Refresh
          </Button>
          {canWrite && items.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => setDeleteAllOpen(true)}
            >
              <Trash2 className="size-3.5" />
              Remove all
            </Button>
          ) : null}
          {canWrite && items.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              title="After long downtime: set every last record to current head so old posts are not alerted"
              onClick={() => void skipAllBacklogs()}
            >
              <SkipForward className="size-3.5" />
              Skip all backlogs
            </Button>
          ) : null}
          {canWrite && items.length > 0 ? (
            <Button type="button" size="sm" disabled={busy} onClick={() => void pollAll()}>
              <Play className="size-3.5" />
              Poll all now
            </Button>
          ) : null}
        </div>
      </div>

      {canWrite ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radar className="size-4 text-primary" />
                Monitor one user
              </CardTitle>
              <CardDescription>
                Cheap path: <code className="text-[11px]">usersByIds</code> tweetCount check →
                only then <code className="text-[11px]">getUserTweets</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={add}
                className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
              >
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="@username"
                  className="w-full font-mono sm:w-40"
                  autoComplete="off"
                />
                <select
                  value={alertMode}
                  onChange={(e) => setAlertMode(e.target.value as "all" | "signals")}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">Every post</option>
                  <option value="signals">Signals only</option>
                </select>
                <select
                  value={manualInterval}
                  onChange={(e) => setManualInterval(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  title="Check interval"
                >
                  {INTERVAL_PRESETS.map((o) => (
                    <option key={o.sec} value={String(o.sec)}>
                      every {o.label}
                    </option>
                  ))}
                </select>
                <TopicPicker
                  value={manualTopic}
                  compact
                  showMeta={false}
                  emptyLabel="Default topic"
                  className="min-w-[8rem]"
                  onChange={setManualTopic}
                />
                <Button type="submit" disabled={busy || !username.trim()}>
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Monitor
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Enroll by tag</CardTitle>
              <CardDescription>
                e.g. all <strong>nft</strong> projects (up to max). Sets shared interval + TG
                topic. Scales to ~1k via tweetCount prefilter.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={enrollByTag}
                className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
              >
                <select
                  value={tagSlug}
                  onChange={(e) => setTagSlug(e.target.value)}
                  className="h-9 min-w-[7rem] rounded-md border border-input bg-background px-2 text-sm"
                >
                  {tags.length === 0 ? (
                    <option value={tagSlug}>{tagSlug}</option>
                  ) : (
                    tags.map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.label || t.slug}
                      </option>
                    ))
                  )}
                </select>
                <select
                  value={tagInterval}
                  onChange={(e) => setTagInterval(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {INTERVAL_PRESETS.map((o) => (
                    <option key={o.sec} value={String(o.sec)}>
                      every {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={tagAlertMode}
                  onChange={(e) => setTagAlertMode(e.target.value as "all" | "signals")}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">Every post</option>
                  <option value="signals">Signals only</option>
                </select>
                <TopicPicker
                  value={tagTopic}
                  compact
                  showMeta={false}
                  emptyLabel="Default topic"
                  className="min-w-[8rem]"
                  onChange={setTagTopic}
                />
                <Input
                  type="number"
                  value={tagMax}
                  onChange={(e) => setTagMax(e.target.value)}
                  className="w-24"
                  min={1}
                  max={5000}
                  title="Max projects"
                />
                <Button type="submit" disabled={busy || !tagSlug.trim()}>
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Enroll tag
                </Button>
              </form>
              {rules.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-border/50 pt-3 text-xs">
                  {rules.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        <Badge variant={r.enabled ? "success" : "muted"} className="mr-1 text-[10px]">
                          {r.tagSlug}
                        </Badge>
                        every {formatInterval(r.intervalSec)}
                        {r.topicId != null ? ` · topic ${r.topicId}` : ""}
                        {" · "}
                        {r.enrolledCount} enrolled
                      </span>
                      <span className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          disabled={busy}
                          onClick={() => void toggleRule(r)}
                        >
                          {r.enabled ? "Off" : "On"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-destructive"
                          disabled={busy}
                          onClick={() => void deleteRule(r.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 py-3">
          <CardTitle className="text-base">Monitored projects</CardTitle>
          <CardDescription>
            Job runs often; each row only does a cheap tweetCount check when its interval is due.
            Timeline fetch only if count increased. Username renames detected via rest id.
            Use <strong>Skip backlog</strong> after downtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No users monitored"
                description="Default is empty. Add @username only for accounts you want to watch."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "px-3 py-3 sm:px-4",
                    !m.isActive && "bg-muted/20 opacity-60",
                  )}
                >
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={`https://x.com/${m.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:underline"
                        >
                          @{m.username}
                        </a>
                        {m.name ? (
                          <span className="truncate text-sm text-muted-foreground">{m.name}</span>
                        ) : null}
                        <a
                          href={`https://x.com/${m.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant={m.isActive ? "success" : "muted"} className="text-[10px]">
                          {m.isActive ? "active" : "off"}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {m.source}
                        </Badge>
                        <Badge variant="muted" className="text-[10px]">
                          {m.alertMode === "signals" ? "signals" : "every post"}
                        </Badge>
                        {!m.alertEnabled ? (
                          <Badge variant="destructive" className="text-[10px]">
                            tg off
                          </Badge>
                        ) : null}
                        {m.primaryTag ? (
                          <Badge variant="muted" className="text-[10px]">
                            {m.primaryTag}
                          </Badge>
                        ) : null}
                        {m.heatAtEnroll != null ? (
                          <Badge variant="secondary" className="text-[10px]">
                            heat {m.heatAtEnroll}
                          </Badge>
                        ) : null}
                        <Badge variant="muted" className="text-[10px]">
                          every {formatInterval(m.intervalSec ?? 300)}
                        </Badge>
                        {m.lastTweetCount != null ? (
                          <Badge variant="muted" className="text-[10px]">
                            tweets {m.lastTweetCount}
                          </Badge>
                        ) : null}
                        {m.usernameChangedAt || m.previousUsername ? (
                          <Badge variant="destructive" className="text-[10px]">
                            renamed
                            {m.previousUsername ? ` from @${m.previousUsername}` : ""}
                          </Badge>
                        ) : null}
                        <span className="text-[11px] text-muted-foreground">
                          alerts {m.alertCount}
                          {m.lastPolledAt ? ` · polled ${fmtDate(m.lastPolledAt)}` : " · never polled"}
                          {m.lastTweetId
                            ? ` · last ${m.lastTweetId.slice(0, 10)}…`
                            : " · no last record"}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        id {m.twitterUserId}
                      </p>
                      {m.lastError ? (
                        <p className="mt-1 text-xs text-destructive">{m.lastError}</p>
                      ) : null}
                    </div>

                    {canWrite ? (
                      <div className="flex flex-col gap-2 sm:min-w-[16rem]">
                        <div className="flex flex-wrap gap-1">
                          <select
                            value={m.alertMode}
                            disabled={busy}
                            onChange={(e) =>
                              void patch(m.id, { alertMode: e.target.value }, "Mode updated")
                            }
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value="all">Every post</option>
                            <option value="signals">Signals only</option>
                          </select>
                          <select
                            value={String(m.intervalSec ?? 300)}
                            disabled={busy}
                            onChange={(e) =>
                              void patch(
                                m.id,
                                { intervalSec: Number(e.target.value) },
                                `Interval ${formatInterval(Number(e.target.value))}`,
                              )
                            }
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            title="Check interval"
                          >
                            {INTERVAL_PRESETS.map((o) => (
                              <option key={o.sec} value={String(o.sec)}>
                                {o.label}
                              </option>
                            ))}
                            {!INTERVAL_PRESETS.some((o) => o.sec === (m.intervalSec ?? 300)) ? (
                              <option value={String(m.intervalSec)}>
                                {formatInterval(m.intervalSec ?? 300)}
                              </option>
                            ) : null}
                          </select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={busy}
                            onClick={() => void pollOne(m.id, m.username)}
                          >
                            <Play className="size-3.5" />
                            Poll
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8"
                            disabled={busy}
                            title="Set last record to current newest post — skip backlog after downtime"
                            onClick={() => void skipBacklog(m.id, m.username)}
                          >
                            <SkipForward className="size-3.5" />
                            Skip backlog
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            disabled={busy}
                            onClick={() =>
                              void patch(
                                m.id,
                                { isActive: !m.isActive },
                                m.isActive ? "Paused" : "Resumed",
                              )
                            }
                          >
                            <Power className="size-3.5" />
                            {m.isActive ? "Pause" : "Resume"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 text-destructive"
                            disabled={busy}
                            onClick={() => setPendingDelete(m)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="shrink-0 text-[10px] text-muted-foreground">Topic</span>
                          <TopicPicker
                            value={m.topicId != null ? String(m.topicId) : ""}
                            compact
                            showMeta={false}
                            emptyLabel="Default"
                            className="min-w-0 flex-1"
                            onChange={(v) =>
                              void patch(
                                m.id,
                                { topicId: v === "" ? null : Number(v) },
                                "Topic saved",
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(o) => {
          if (!o && !busy) setPendingDelete(null);
        }}
        title={`Remove @${pendingDelete?.username}?`}
        description="Stops polling this user’s timeline. Does not change Hunter stage or Project Lists."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmDialog
        open={deleteAllOpen}
        onOpenChange={(o) => {
          if (!o && !busy) setDeleteAllOpen(false);
        }}
        title="Remove ALL monitored users?"
        description={`Deletes all ${items.length} monitors. List returns to empty (default).`}
        confirmLabel="Remove all"
        destructive
        loading={busy}
        onConfirm={() => void confirmDeleteAll()}
      />
    </div>
  );
}
