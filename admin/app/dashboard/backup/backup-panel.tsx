"use client";

import { useRef, useState } from "react";
import {
  Download,
  Upload,
  RefreshCw,
  DatabaseBackup,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { fmtNum } from "@/lib/types";

type TableRow = { key: string; table: string; count: number };

export function BackupPanel({
  initialTables,
  initialTotal,
}: {
  initialTables: TableRow[];
  initialTotal: number;
}) {
  const canAdmin = useCan("admin");
  const fileRef = useRef<HTMLInputElement>(null);

  const [tables, setTables] = useState(initialTables);
  const [total, setTotal] = useState(initialTotal);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [pendingImport, setPendingImport] = useState<unknown | null>(null);
  const [lastImport, setLastImport] = useState<{
    imported: Record<string, number>;
    wiped: Record<string, number>;
    skipped?: Record<string, number>;
    errors: string[];
    mode: string;
  } | null>(null);

  async function refresh() {
    setBusy(true);
    try {
      const res = await proxy("/api/backup/summary");
      if (res.ok) {
        const body = res.body as { tables: TableRow[]; totalRows: number };
        setTables(body.tables);
        setTotal(body.totalRows);
      } else toast.error("Failed to refresh summary");
    } finally {
      setBusy(false);
    }
  }

  async function downloadBackup(full = false) {
    if (!canAdmin) return;
    setBusy(true);
    toast.message(
      full
        ? "Exporting full history — this can take several minutes…"
        : "Exporting compact backup (latest follow snapshots only)…",
    );
    try {
      // Compact by default: full follow_snapshot history previously OOMed the API.
      const qs = full ? "?full=1" : "";
      const res = await fetch(`/api/proxy/api/backup/export${qs}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `Export failed (${res.status})`;
        try {
          const j = JSON.parse(text) as {
            error?: string;
            message?: string;
          };
          if (j.message) msg = j.message;
          else if (j.error) msg = j.error;
        } catch {
          if (text && text.length < 200) msg = text;
        }
        if (res.status === 502 || res.status === 0) {
          msg +=
            " — API may have crashed; restart it and use compact export (default).";
        }
        toast.error(msg);
        return;
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        toast.error(
          "Export returned empty file. Restart the API (export may have crashed it) and try compact download again.",
        );
        return;
      }

      const cd = res.headers.get("content-disposition");
      const match = cd?.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
      const filename = decodeURIComponent(
        match?.[1]?.trim() ??
          `early-alpha-backup-${new Date().toISOString().slice(0, 10)}.json`,
      );

      // Must attach to DOM for Safari / some Chromium builds to start download.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Delay revoke so the browser can finish reading the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);

      const mb = (blob.size / (1024 * 1024)).toFixed(2);
      const warn = res.headers.get("x-backup-warnings");
      toast.success(`Downloaded ${filename} (${mb} MB)`);
      if (warn) toast.message(warn);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download failed";
      toast.error(
        `${msg}. If the API died, restart it — use compact export (not full history).`,
      );
    } finally {
      setBusy(false);
    }
  }

  function onPickFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        if (!json || typeof json !== "object" || !json.tables) {
          toast.error("Not a valid early-alpha backup file");
          return;
        }
        setPendingImport(json);
      } catch {
        toast.error("Could not parse JSON file");
      }
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (!pendingImport || !canAdmin) return;
    setBusy(true);
    try {
      const res = await proxy("/api/backup/import", {
        method: "POST",
        body: { backup: pendingImport, mode },
      });
      if (res.ok) {
        const body = res.body as {
          imported: Record<string, number>;
          wiped: Record<string, number>;
          skipped?: Record<string, number>;
          errors: string[];
          mode: string;
        };
        setLastImport(body);
        setPendingImport(null);
        const n = Object.values(body.imported ?? {}).reduce((a, b) => a + b, 0);
        const sk = Object.values(body.skipped ?? {}).reduce((a, b) => a + b, 0);
        toast.success(
          `Import ${body.mode}: ${n} rows written` +
            (sk ? `, ${sk} skipped` : "") +
            (body.errors?.length ? ` (${body.errors.length} notes)` : ""),
        );
        await refresh();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? `Import failed (${res.status})`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!canAdmin) {
    return (
      <p className="text-sm text-muted-foreground">Admin role required for backups.</p>
    );
  }

  const importCounts =
    pendingImport &&
    typeof pendingImport === "object" &&
    pendingImport !== null &&
    "counts" in pendingImport
      ? (pendingImport as { counts: Record<string, number> }).counts
      : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="size-4 text-primary" />
            Database snapshot
          </CardTitle>
          <CardDescription>
            {fmtNum(total)} rows across {tables.length} tables. Export includes{" "}
            <strong>auth tokens, ct0, Telegram bot tokens, passwords</strong> —
            treat the file as a secret.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Default export is <strong>compact</strong>: latest follow snapshot per
            watched account only. Full historical snapshots can be multi‑GB and
            previously crashed the API — only use full when you really need them.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void downloadBackup(false)}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Download backup
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              title="Includes every follow_snapshot row — can crash the API on large DBs"
              onClick={() => void downloadBackup(true)}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Download full history
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-3.5" />
              Refresh counts
            </Button>
            <span className="text-xs text-muted-foreground sm:self-center">
              CLI:{" "}
              <code className="text-[11px]">npm run db:export -- ./backup.json</code>
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Tables</CardTitle>
            <CardDescription>Current row counts</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-[min(28rem,60dvh)] space-y-1 overflow-y-auto text-sm">
              {tables.map((t) => (
                <li
                  key={t.table}
                  className="flex items-center justify-between gap-2 border-b border-border/40 py-1.5 last:border-0"
                >
                  <span className="font-mono text-xs">{t.table}</span>
                  <Badge variant="muted" className="tabular-nums">
                    {t.count}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Import backup</CardTitle>
            <CardDescription>
              Upload a JSON file from Download or{" "}
              <code className="text-xs">npm run db:export</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-primary-foreground"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
            </div>

            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                />
                <span>
                  <strong>Merge</strong> — insert missing rows, skip duplicates
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                />
                <span>
                  <strong>Replace</strong> — wipe tables then restore (destructive)
                </span>
              </label>
            </div>

            {mode === "replace" ? (
              <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Replace deletes existing data in all backed-up tables before
                importing. Export a fresh backup first.
              </p>
            ) : null}

            {pendingImport ? (
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                <p className="font-medium">File ready to import</p>
                {importCounts ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Object.values(importCounts).reduce((a, b) => a + b, 0)} rows
                    in backup · mode: {mode}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    variant={mode === "replace" ? "destructive" : "default"}
                    onClick={() => void runImport()}
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    {mode === "replace" ? "Wipe & import" : "Import (merge)"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setPendingImport(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a <code className="text-xs">.json</code> backup file above.
              </p>
            )}

            {lastImport ? (
              <div className="rounded-md border border-border p-3 text-xs">
                <p className="font-medium">Last import ({lastImport.mode})</p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto font-mono">
                  {Object.entries(lastImport.imported)
                    .filter(([, c]) => c > 0)
                    .map(([t, c]) => (
                      <li key={t}>
                        + {t}: {c}
                      </li>
                    ))}
                  {Object.entries(lastImport.skipped ?? {})
                    .filter(([, c]) => c > 0)
                    .map(([t, c]) => (
                      <li key={`s-${t}`} className="text-muted-foreground">
                        ~ {t}: {c} skipped
                      </li>
                    ))}
                </ul>
                {lastImport.errors?.length ? (
                  <p className="mt-2 text-destructive">
                    {lastImport.errors.length} note(s) — first:{" "}
                    {lastImport.errors[0]}
                  </p>
                ) : null}
              </div>
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              CLI import:{" "}
              <code>npm run db:import -- ./backup.json</code> or{" "}
              <code>npm run db:import -- ./backup.json --replace</code>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
