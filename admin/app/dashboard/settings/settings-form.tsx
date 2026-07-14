"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { fmtDate } from "@/lib/types";
import type { SettingItem } from "./page";

const COMMON_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "CLAUDE_API_KEY",
  "LIST_OWNER_USERNAME",
];

export function SettingsForm({ initial }: { initial: SettingItem[] }) {
  const router = useRouter();
  const canAdmin = useCan("admin");
  const [items, setItems] = useState(initial);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await proxy("/api/settings");
    if (res.ok) {
      setItems((res.body as { items: SettingItem[] }).items);
    }
    router.refresh();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdmin) return;
    const k = key.trim();
    if (!k) {
      toast.error("Key required");
      return;
    }
    setBusy(true);
    const res = await proxy("/api/settings", {
      method: "PUT",
      body: { key: k, value },
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Saved ${k}`);
      setValue("");
      await refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Stored keys</CardTitle>
          <CardDescription>
            Values are never shown in full — only a masked suffix.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              title="No settings yet"
              description="Add a key on the right (admin only)."
            />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {items.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium">{row.key}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.hasValue ? row.masked : "empty"} · {fmtDate(row.updatedAt)}
                    </div>
                  </div>
                  {canAdmin ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setKey(row.key);
                        setValue("");
                      }}
                    >
                      Update
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Set / update</CardTitle>
          <CardDescription>
            Paste the full secret. It replaces any previous value for that key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canAdmin ? (
            <p className="text-sm text-muted-foreground">
              Viewer/editor — only admins can change settings.
            </p>
          ) : (
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Key</label>
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="e.g. CLAUDE_API_KEY"
                  className="font-mono text-xs"
                  list="settings-keys"
                />
                <datalist id="settings-keys">
                  {COMMON_KEYS.map((k) => (
                    <option key={k} value={k} />
                  ))}
                  {items.map((r) => (
                    <option key={r.key} value={r.key} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Value</label>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="secret value"
                  type="password"
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_KEYS.map((k) => (
                  <button key={k} type="button" onClick={() => setKey(k)}>
                    <Badge variant="muted" className="cursor-pointer font-mono text-[10px]">
                      {k}
                    </Badge>
                  </button>
                ))}
              </div>
              <Button type="submit" disabled={busy || !key.trim()}>
                {busy ? "Saving…" : "Save setting"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
