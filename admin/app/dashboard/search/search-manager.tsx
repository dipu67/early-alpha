"use client";

import { useEffect, useState } from "react";
import {
  Play,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  ExternalLink,
  Search,
  Pencil,
  X,
  Save,
  Loader2,
  SkipForward,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TopicPicker } from "@/components/topic-picker";
import { cn } from "@/lib/cn";
import { fmtDate, type AuthAccount, type SearchHitItem, type SearchQueryItem } from "@/lib/types";

const INTERVAL_OPTIONS = [
  { sec: 60, label: "1 min" },
  { sec: 120, label: "2 min" },
  { sec: 180, label: "3 min" },
  { sec: 300, label: "5 min" },
  { sec: 600, label: "10 min" },
  { sec: 900, label: "15 min" },
  { sec: 1800, label: "30 min" },
];

function formatInterval(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

type EditDraft = {
  query: string;
  label: string;
  authAccountId: string;
  topicId: string;
  intervalSec: string;
  alertEnabled: boolean;
  enabled: boolean;
  resetWatermark: boolean;
};

function draftFromQuery(q: SearchQueryItem): EditDraft {
  return {
    query: q.query,
    label: q.label ?? "",
    authAccountId: q.authAccountId ?? "",
    topicId: q.topicId != null ? String(q.topicId) : "",
    intervalSec: String(q.intervalSec),
    alertEnabled: q.alertEnabled,
    enabled: q.enabled,
    resetWatermark: false,
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

export function SearchManager({
  initialQueries,
  initialHits,
  authAccounts,
}: {
  initialQueries: SearchQueryItem[];
  initialHits: SearchHitItem[];
  authAccounts: AuthAccount[];
}) {
  const canWrite = useCan("editor");
  const [queries, setQueries] = useState(initialQueries);
  const [hits, setHits] = useState(initialHits);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [authId, setAuthId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [intervalSec, setIntervalSec] = useState("120");

  useEffect(() => {
    setQueries(initialQueries);
  }, [initialQueries]);

  useEffect(() => {
    setHits(initialHits);
  }, [initialHits]);

  async function refresh() {
    const [qRes, hRes] = await Promise.all([
      proxy("/api/search-queries"),
      proxy("/api/search-queries/hits?limit=20"),
    ]);
    if (qRes.ok) {
      setQueries((qRes.body as { items: SearchQueryItem[] }).items);
    }
    if (hRes.ok) setHits((hRes.body as { items: SearchHitItem[] }).items);
  }

  function openEdit(q: SearchQueryItem) {
    setEditingId(q.id);
    setDraft(draftFromQuery(q));
  }

  function closeEdit() {
    setEditingId(null);
    setDraft(null);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite || !query.trim()) return;
    setBusy(true);
    const topic = topicId.trim() === "" ? null : Number(topicId);
    if (topicId.trim() !== "" && !Number.isFinite(topic)) {
      toast.error("Topic id must be a number");
      setBusy(false);
      return;
    }
    const res = await proxy("/api/search-queries", {
      method: "POST",
      body: {
        query: query.trim(),
        label: label.trim() || null,
        authAccountId: authId || null,
        topicId: topic,
        alertEnabled: true,
        intervalSec: Math.max(30, Number(intervalSec) || 120),
        enabled: true,
      },
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Query added — first Run seeds watermark (no alert flood)");
      setQuery("");
      setLabel("");
      setTopicId("");
      await refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite || !editingId || !draft) return;
    if (!draft.query.trim()) {
      toast.error("Query is required");
      return;
    }
    const topic = draft.topicId.trim() === "" ? null : Number(draft.topicId);
    if (draft.topicId.trim() !== "" && !Number.isFinite(topic)) {
      toast.error("Topic id must be a number");
      return;
    }
    const interval = Math.max(30, Math.min(3600, Number(draft.intervalSec) || 120));

    setBusy(true);
    const body: Record<string, unknown> = {
      query: draft.query.trim(),
      label: draft.label.trim() || null,
      authAccountId: draft.authAccountId || null,
      topicId: topic,
      intervalSec: interval,
      alertEnabled: draft.alertEnabled,
      enabled: draft.enabled,
    };
    if (draft.resetWatermark) {
      body.lastTweetId = null;
      body.lastPolledAt = null;
    }

    const res = await proxy(`/api/search-queries/${editingId}`, {
      method: "PATCH",
      body,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(
        draft.resetWatermark
          ? "Saved + watermark cleared (next Run re-seeds)"
          : "Query updated",
      );
      closeEdit();
      await refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy(`/api/search-queries/${id}`, { method: "PATCH", body });
    setBusy(false);
    if (res.ok) {
      toast.success(ok);
      await refresh();
    } else toast.error("Failed");
  }

  async function del(id: string) {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy(`/api/search-queries/${id}`, { method: "DELETE" });
    setBusy(false);
    setPendingDeleteId(null);
    if (res.ok) {
      toast.success("Deleted");
      if (editingId === id) closeEdit();
      await refresh();
    } else toast.error("Failed");
  }

  async function runOne(id: string) {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy(`/api/search-queries/${id}/run`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      const b = res.body as {
        newHits?: number;
        alerted?: number;
        seeded?: boolean;
        fetched?: number;
        error?: string;
      };
      if (b.error) toast.error(b.error);
      else if (b.seeded)
        toast.success(
          `Watermark set (fetched ${b.fetched ?? 0}). Next Run alerts on newer tweets only.`,
        );
      else if ((b.fetched ?? 0) === 0)
        toast.error(
          "Search returned 0 tweets — simplify the query (use -filter:replies, not -is:reply)",
        );
      else
        toast.success(
          `Fetched ${b.fetched ?? 0} · new ${b.newHits ?? 0} · Telegram ${b.alerted ?? 0}`,
        );
      await refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function runAll() {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy("/api/search-queries/run-all", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      toast.success("Poll-all enqueued");
      setTimeout(() => void refresh(), 2000);
    } else toast.error("Failed to enqueue");
  }

  async function skipBacklog(id: string) {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy(`/api/search-queries/${id}/skip-backlog`, {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (res.ok) {
      const b = res.body as { seeded?: boolean; skippedPoll?: boolean; error?: string };
      if (b.error) toast.error(b.error);
      else if (b.skippedPoll)
        toast.success("Last record cleared (paused — enable + Run to re-seed)");
      else if (b.seeded)
        toast.success("Last record set to now — backlog skipped");
      else toast.success("Last record updated");
      await refresh();
    } else toast.error("Skip backlog failed");
  }

  async function skipAllBacklogs() {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy("/api/search-queries/skip-all-backlogs", {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (res.ok) {
      const b = res.body as { cleared?: number };
      toast.success(
        `Cleared last record on ${b.cleared ?? queries.length} queries — re-seeding`,
      );
      setTimeout(() => void refresh(), 2000);
    } else toast.error("Skip all failed");
  }

  const activeAuths = authAccounts.filter((a) => a.isActive && !a.rateLimited);
  const enabledCount = queries.filter((q) => q.enabled).length;

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{enabledCount} active</Badge>
        <Badge variant="muted">{queries.length} queries</Badge>
        <Badge variant="muted">{hits.length} recent hits</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            Refresh
          </Button>
          {canWrite && queries.length > 0 ? (
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
          {canWrite ? (
            <Button type="button" size="sm" disabled={busy} onClick={() => void runAll()}>
              <Play className="size-3.5" />
              Poll all
            </Button>
          ) : null}
        </div>
      </div>

      {activeAuths.length === 0 ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          No active free auth accounts — add cookies under Auth Pool or queries will fail.
        </p>
      ) : null}

      {/* Create + list */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="size-4 text-sky-500" />
            Search queries
          </CardTitle>
          <CardDescription>
            Realtime Twitter search → Telegram. First Run seeds last record only; later Runs alert
            on newer posts. After downtime use <strong>Skip backlog</strong> to set last record to
            now (no flood).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {canWrite ? (
            <form
              onSubmit={create}
              className="space-y-3 rounded-xl border border-dashed border-border bg-muted/20 p-3"
            >
              <div className="space-y-1">
                <FieldLabel>Query</FieldLabel>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder='(gamefi OR "nft game") -filter:replies -filter:retweets lang:en'
                  className="font-mono text-xs"
                  required
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <FieldLabel>Label</FieldLabel>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. GameFi"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Auth account</FieldLabel>
                  <select
                    value={authId}
                    onChange={(e) => setAuthId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Rotate pool</option>
                    {authAccounts.map((a) => (
                      <option
                        key={a.id}
                        value={a.id}
                        disabled={!a.isActive || a.rateLimited}
                      >
                        @{a.username}
                        {a.rateLimited ? " · limited" : ""}
                        {!a.isActive ? " · off" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <FieldLabel>TG topic</FieldLabel>
                  <TopicPicker
                    value={topicId}
                    emptyLabel="Default"
                    compact
                    showMeta={false}
                    onChange={(v) => setTopicId(v)}
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Poll every</FieldLabel>
                  <select
                    value={intervalSec}
                    onChange={(e) => setIntervalSec(e.target.value)}
                    className={selectClass}
                  >
                    {INTERVAL_OPTIONS.map((o) => (
                      <option key={o.sec} value={String(o.sec)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy || !query.trim()}>
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Add query
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Editor+ required to manage queries.</p>
          )}

          {queries.length === 0 ? (
            <EmptyState
              title="No search queries"
              description='Add a query like (gamefi OR "nft game") -filter:replies -filter:retweets'
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {queries.map((q) => {
                const isEditing = editingId === q.id && draft;
                return (
                  <li
                    key={q.id}
                    className={cn(
                      "bg-card px-3 py-3 sm:px-4",
                      !q.enabled && "bg-muted/20 opacity-70",
                      isEditing && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                    )}
                  >
                    {!isEditing ? (
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {q.label ? (
                              <span className="font-medium">{q.label}</span>
                            ) : null}
                            {q.enabled ? (
                              <Badge variant="success" className="text-[10px]">
                                on
                              </Badge>
                            ) : (
                              <Badge variant="muted" className="text-[10px]">
                                off
                              </Badge>
                            )}
                            {!q.alertEnabled ? (
                              <Badge variant="muted" className="text-[10px]">
                                tg off
                              </Badge>
                            ) : null}
                            {q.lastError ? (
                              <Badge variant="destructive" className="text-[10px]">
                                error
                              </Badge>
                            ) : null}
                            <Badge variant="muted" className="text-[10px]">
                              every {formatInterval(q.intervalSec)}
                            </Badge>
                          </div>
                          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            {q.query}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span>
                              Auth{" "}
                              <strong className="text-foreground">
                                {q.authUsername ? `@${q.authUsername}` : "rotate"}
                              </strong>
                            </span>
                            <span>
                              Topic{" "}
                              <strong className="text-foreground">
                                {q.topicId != null ? q.topicId : "default"}
                              </strong>
                            </span>
                            <span>
                              hits <strong className="text-foreground">{q.hitCount}</strong>
                            </span>
                            <span>
                              wm{" "}
                              <code className="text-[10px]">
                                {q.lastTweetId ? `${q.lastTweetId.slice(0, 10)}…` : "—"}
                              </code>
                            </span>
                            <span>last {fmtDate(q.lastPolledAt)}</span>
                          </div>
                          {q.lastError ? (
                            <p className="mt-1 text-xs text-destructive">{q.lastError}</p>
                          ) : null}
                        </div>

                        {canWrite ? (
                          <div className="flex shrink-0 flex-wrap items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-8"
                              disabled={busy}
                              onClick={() => void runOne(q.id)}
                            >
                              <Play className="size-3.5" />
                              Run
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              disabled={busy}
                              title="Set last record to current newest match — skip backlog after downtime"
                              onClick={() => void skipBacklog(q.id)}
                            >
                              <SkipForward className="size-3.5" />
                              Skip backlog
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              disabled={busy}
                              onClick={() => openEdit(q)}
                            >
                              <Pencil className="size-3.5" />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              disabled={busy}
                              onClick={() =>
                                void patch(
                                  q.id,
                                  { enabled: !q.enabled },
                                  q.enabled ? "Paused" : "Enabled",
                                )
                              }
                            >
                              <Power className="size-3.5" />
                              {q.enabled ? "Pause" : "On"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 text-destructive hover:text-destructive"
                              disabled={busy}
                              onClick={() => setPendingDeleteId(q.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <form onSubmit={saveEdit} className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">Edit query</span>
                          <Button type="button" variant="ghost" size="sm" onClick={closeEdit}>
                            <X className="size-3.5" />
                            Cancel
                          </Button>
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Query</FieldLabel>
                          <Input
                            value={draft.query}
                            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
                            className="font-mono text-xs"
                            required
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="space-y-1">
                            <FieldLabel>Label</FieldLabel>
                            <Input
                              value={draft.label}
                              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                              placeholder="optional"
                            />
                          </div>
                          <div className="space-y-1">
                            <FieldLabel>Auth</FieldLabel>
                            <select
                              value={draft.authAccountId}
                              onChange={(e) =>
                                setDraft({ ...draft, authAccountId: e.target.value })
                              }
                              className={selectClass}
                            >
                              <option value="">Rotate pool</option>
                              {authAccounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  @{a.username}
                                  {!a.isActive ? " · off" : ""}
                                  {a.rateLimited ? " · limited" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <FieldLabel>TG topic</FieldLabel>
                            <TopicPicker
                              value={draft.topicId}
                              emptyLabel="Default"
                              compact
                              showMeta={false}
                              onChange={(v) => setDraft({ ...draft, topicId: v })}
                            />
                          </div>
                          <div className="space-y-1">
                            <FieldLabel>Poll every</FieldLabel>
                            <select
                              value={draft.intervalSec}
                              onChange={(e) =>
                                setDraft({ ...draft, intervalSec: e.target.value })
                              }
                              className={selectClass}
                            >
                              {INTERVAL_OPTIONS.map((o) => (
                                <option key={o.sec} value={String(o.sec)}>
                                  {o.label}
                                </option>
                              ))}
                              {!INTERVAL_OPTIONS.some(
                                (o) => String(o.sec) === draft.intervalSec,
                              ) ? (
                                <option value={draft.intervalSec}>
                                  {formatInterval(Number(draft.intervalSec) || 120)}
                                </option>
                              ) : null}
                            </select>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              onChange={(e) =>
                                setDraft({ ...draft, enabled: e.target.checked })
                              }
                              className="size-4 accent-primary"
                            />
                            Enabled
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={draft.alertEnabled}
                              onChange={(e) =>
                                setDraft({ ...draft, alertEnabled: e.target.checked })
                              }
                              className="size-4 accent-primary"
                            />
                            Telegram alerts
                          </label>
                          <label className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                            <input
                              type="checkbox"
                              checked={draft.resetWatermark}
                              onChange={(e) =>
                                setDraft({ ...draft, resetWatermark: e.target.checked })
                              }
                              className="size-4 accent-primary"
                            />
                            Reset lastTweetId
                          </label>
                        </div>
                        {draft.resetWatermark ? (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Next poll re-seeds watermark only (no history flood).
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                          <Button
                            type="submit"
                            size="sm"
                            disabled={busy || !draft.query.trim()}
                          >
                            <Save className="size-3.5" />
                            {busy ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void runOne(q.id)}
                          >
                            <Play className="size-3.5" />
                            Run now
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={closeEdit}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Hits */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 py-3">
          <div>
            <CardTitle className="text-base">Recent posts</CardTitle>
            <CardDescription>
              Realtime only — latest ~20 hits per query (older pruned)
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={busy}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {hits.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No hits yet"
                description="Run a query or wait for the search-poll scheduler (~1 min)."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {hits.map((h) => (
                <li key={h.id} className="px-3 py-3 text-sm sm:px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <a
                        href={`https://x.com/${h.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        @{h.username}
                      </a>
                      <Badge variant="muted" className="max-w-[12rem] truncate text-[10px]">
                        {h.queryLabel || h.query}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{fmtDate(h.postedAt ?? h.createdAt)}</span>
                      <a
                        href={`https://x.com/${h.username}/status/${h.tweetId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-primary hover:underline"
                      >
                        Open <ExternalLink className="size-3" />
                      </a>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                    {h.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDeleteId != null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingDeleteId(null);
        }}
        title="Delete search query?"
        description="Deletes this query and its stored hits. Cannot be undone."
        confirmLabel="Delete query"
        destructive
        loading={busy}
        onConfirm={() => {
          if (pendingDeleteId) void del(pendingDeleteId);
        }}
      />
    </div>
  );
}
