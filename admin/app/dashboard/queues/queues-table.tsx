"use client";

import { useState } from "react";
import { Play, Pause, Zap, Trash2, Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { fmtDate, fmtEvery, type Scheduler } from "@/lib/types";

/** Loose cron check: 5 space-separated fields (minute hour dom month dow). */
function isLikelyCron(s: string): boolean {
  const parts = s.trim().split(/\s+/);
  return parts.length === 5 || parts.length === 6;
}

export function QueuesTable({ initial }: { initial: Scheduler[] }) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);

  async function refresh() {
    const res = await proxy("/api/queues");
    if (res.ok) setRows((res.body as { items: Scheduler[] }).items);
  }

  async function act(path: string, body?: unknown, ok = "Done") {
    const res = await proxy(path, { method: "POST", body });
    if (res.ok) {
      toast.success(ok);
      refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function saveSchedule(
    key: string,
    schedule: { every?: number; cron?: string },
  ) {
    const res = await proxy(`/api/queues/${key}`, {
      method: "PATCH",
      body: schedule,
    });
    if (res.ok) {
      toast.success("Schedule updated");
      setEditing(null);
      refresh();
    } else {
      const b = res.body as { error?: string; issues?: unknown } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table className="min-w-[48rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Job</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Next run</TableHead>
            <TableHead>Queue counts</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.key}>
              <TableCell>
                <div className="font-medium">{s.label}</div>
                <div className="font-mono text-xs text-muted-foreground">{s.jobName}</div>
              </TableCell>
              <TableCell>
                {editing === s.key ? (
                  <ScheduleEditor
                    scheduler={s}
                    onSave={(body) => saveSchedule(s.key, body)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <span className="text-muted-foreground">
                    {s.cron ? (
                      <>
                        <Badge variant="secondary" className="mr-1.5">
                          cron
                        </Badge>
                        <code className="text-xs">{s.cron}</code>
                      </>
                    ) : (
                      <>
                        <Badge variant="muted" className="mr-1.5">
                          interval
                        </Badge>
                        every {fmtEvery(s.every)}
                      </>
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {s.paused ? "—" : s.nextRun ? fmtDate(new Date(s.nextRun).toISOString()) : "—"}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1 text-xs">
                  {(["active", "waiting", "delayed", "failed"] as const).map((k) =>
                    s.counts[k] ? (
                      <Badge key={k} variant={k === "failed" ? "destructive" : "muted"}>
                        {k} {s.counts[k]}
                      </Badge>
                    ) : null,
                  )}
                </div>
              </TableCell>
              <TableCell>
                {s.paused ? (
                  <Badge variant="muted">paused</Badge>
                ) : (
                  <Badge variant="success">running</Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Trigger now"
                    onClick={() => act(`/api/queues/${s.key}/trigger`, undefined, "Enqueued")}
                  >
                    <Zap className="size-4" />
                  </Button>
                  {s.paused ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Resume"
                      onClick={() => act(`/api/queues/${s.key}/resume`)}
                    >
                      <Play className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Pause"
                      onClick={() => act(`/api/queues/${s.key}/pause`)}
                    >
                      <Pause className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit schedule (interval or cron)"
                    onClick={() => setEditing(s.key)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {s.counts.failed ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Clean failed"
                      onClick={() =>
                        act(`/api/queues/${s.key}/clean-failed`, undefined, "Cleaned")
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ScheduleEditor({
  scheduler,
  onSave,
  onCancel,
}: {
  scheduler: Scheduler;
  onSave: (body: { every?: number; cron?: string }) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"interval" | "cron">(
    scheduler.cron ? "cron" : "interval",
  );
  const [minutes, setMinutes] = useState(
    String(scheduler.every ? Math.max(1, scheduler.every / 60000) : 15),
  );
  const [cron, setCron] = useState(scheduler.cron ?? "0 9 * * *");

  function submit() {
    if (mode === "cron") {
      const pattern = cron.trim();
      if (!pattern) {
        toast.error("Cron pattern required");
        return;
      }
      if (!isLikelyCron(pattern)) {
        toast.error("Cron should be 5 fields, e.g. 0 9 * * *");
        return;
      }
      onSave({ cron: pattern });
      return;
    }
    const m = Number(minutes);
    if (!(m > 0)) {
      toast.error("Minutes must be > 0");
      return;
    }
    // Backend min is 10_000 ms (10s); clamp UI to whole minutes.
    onSave({ every: Math.round(m * 60_000) });
  }

  return (
    <div className="flex min-w-[16rem] flex-col gap-2 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "interval" | "cron")}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="interval">Interval</option>
          <option value="cron">Cron</option>
        </select>

        {mode === "interval" ? (
          <>
            <Input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="h-8 w-20"
              min={1}
              step={1}
            />
            <span className="text-xs text-muted-foreground">min</span>
          </>
        ) : (
          <Input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 9 * * *"
            className="h-8 min-w-[10rem] flex-1 font-mono text-xs"
            title="minute hour day-of-month month day-of-week"
          />
        )}
      </div>
      {mode === "cron" ? (
        <p className="text-[11px] text-muted-foreground">
          Format: <code>min hour dom month dow</code> — e.g.{" "}
          <code>0 9 * * *</code> daily 09:00, <code>0 */6 * * *</code> every 6h
        </p>
      ) : null}
      <div className="flex items-center gap-1">
        <Button size="sm" onClick={submit}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
