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
import { fmtDate, type ProjectMonitorItem } from "@/lib/types";
import { cn } from "@/lib/cn";

export function MonitorsPanel({ initialItems }: { initialItems: ProjectMonitorItem[] }) {
  const canWrite = useCan("editor");
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [alertMode, setAlertMode] = useState<"all" | "signals">("all");
  const [pendingDelete, setPendingDelete] = useState<ProjectMonitorItem | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await proxy("/api/monitors");
      if (res.ok) {
        const body = res.body as { items: ProjectMonitorItem[] };
        setItems(body.items ?? []);
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
        body: { username: raw, alertMode, source: "manual" },
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
            <Button type="button" size="sm" disabled={busy} onClick={() => void pollAll()}>
              <Play className="size-3.5" />
              Poll all now
            </Button>
          ) : null}
        </div>
      </div>

      {canWrite ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="size-4 text-primary" />
              Monitor a user
            </CardTitle>
            <CardDescription>
              List is empty until you add someone. Polls{" "}
              <code className="text-[11px]">getUserTweets</code> → Telegram{" "}
              <strong>monitor</strong>. Nothing is added automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
                className="w-full font-mono sm:w-48"
                autoComplete="off"
              />
              <select
                value={alertMode}
                onChange={(e) => setAlertMode(e.target.value as "all" | "signals")}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="all">Every post</option>
                <option value="signals">Signals only (mint/TGE/…)</option>
              </select>
              <Button type="submit" disabled={busy || !username.trim()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Monitor
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 py-3">
          <CardTitle className="text-base">Monitored users</CardTitle>
          <CardDescription>
            Each row is one @username timeline. Polled ~every 2 min. First poll seeds watermark only
            (no history flood). Separate from Project Lists.
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
                        <span className="text-[11px] text-muted-foreground">
                          alerts {m.alertCount}
                          {m.lastPolledAt ? ` · polled ${fmtDate(m.lastPolledAt)}` : " · never polled"}
                        </span>
                      </div>
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
