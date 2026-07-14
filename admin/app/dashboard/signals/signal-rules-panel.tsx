"use client";

/**
 * Signal keyword rules UI — same chip style as Keywords page.
 * Data lives in signal_rules (DB). Detection uses these keywords on new posts.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Database, X, Power } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { cn } from "@/lib/cn";

export type SignalRuleItem = {
  id: string;
  slug: string | null;
  category: string;
  label: string;
  pattern: string;
  isRegex: boolean;
  enabled: boolean;
};

const CATEGORIES = ["mint", "wl", "tge", "launch", "sale", "other"] as const;

function inferCategory(pattern: string): string {
  const p = pattern.toLowerCase();
  if (/mint|reveal|drop/.test(p)) return "mint";
  if (/whitelist|allowlist|waitlist|\bwl\b/.test(p)) return "wl";
  if (/tge|token|claim|airdrop|snapshot/.test(p)) return "tge";
  if (/launch|live|mainnet|beta/.test(p)) return "launch";
  if (/presale|sale|listing|trading/.test(p)) return "sale";
  return "other";
}

function groupKey(slug: string | null): string {
  return slug && slug.trim() ? slug.trim().toLowerCase() : "__generic__";
}

function displayGroup(key: string): string {
  return key === "__generic__" ? "generic (all tags)" : key;
}

export function SignalRulesPanel({
  initialRules,
  tags,
}: {
  initialRules: SignalRuleItem[];
  tags: { slug: string; label?: string }[];
}) {
  const canWrite = useCan("editor");
  const [rules, setRules] = useState(initialRules);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string>("__generic__");
  const [kwInput, setKwInput] = useState("");
  const [kwCategory, setKwCategory] = useState<string>("mint");
  const [isRegex, setIsRegex] = useState(false);

  useEffect(() => {
    setRules(initialRules);
  }, [initialRules]);

  const groups = useMemo(() => {
    const map = new Map<string, SignalRuleItem[]>();
    map.set("__generic__", []);
    for (const t of tags) map.set(t.slug, []);
    for (const r of rules) {
      const k = groupKey(r.slug);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
  }, [rules, tags]);

  const groupList = useMemo(() => {
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === "__generic__") return -1;
      if (b === "__generic__") return 1;
      return a.localeCompare(b);
    });
    const q = filter.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => {
      if (k.includes(q) || displayGroup(k).includes(q)) return true;
      return (groups.get(k) ?? []).some(
        (r) =>
          r.pattern.toLowerCase().includes(q) ||
          r.label.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q),
      );
    });
  }, [groups, filter]);

  const activeRules = groups.get(selected) ?? [];
  const byCategory = useMemo(() => {
    const m = new Map<string, SignalRuleItem[]>();
    for (const c of CATEGORIES) m.set(c, []);
    for (const r of activeRules) {
      const c = CATEGORIES.includes(r.category as (typeof CATEGORIES)[number])
        ? r.category
        : "other";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(r);
    }
    return m;
  }, [activeRules]);

  async function refresh() {
    const res = await proxy("/api/signals/rules");
    if (res.ok) {
      setRules((res.body as { items: SignalRuleItem[] }).items ?? []);
    }
  }

  async function seed() {
    setBusy(true);
    try {
      const res = await proxy("/api/signals/rules/seed", { method: "POST", body: {} });
      if (res.ok) {
        const r = res.body as { inserted?: number; total?: number };
        toast.success(
          r.inserted
            ? `Seeded ${r.inserted} keywords (${r.total} total)`
            : `Already loaded (${r.total ?? rules.length} keywords)`,
        );
        await refresh();
      } else toast.error("Seed failed");
    } finally {
      setBusy(false);
    }
  }

  async function addKeyword() {
    const pattern = kwInput.trim();
    if (!pattern) {
      toast.error("Enter a keyword");
      return;
    }
    const slug = selected === "__generic__" ? null : selected;
    // Dedupe against existing in group
    if (
      activeRules.some(
        (r) => r.pattern.toLowerCase() === pattern.toLowerCase() && r.isRegex === isRegex,
      )
    ) {
      toast.error("Keyword already exists in this group");
      return;
    }
    setBusy(true);
    try {
      const res = await proxy("/api/signals/rules", {
        method: "POST",
        body: {
          slug,
          pattern,
          label: pattern,
          category: kwCategory || inferCategory(pattern),
          isRegex,
          enabled: true,
        },
      });
      if (res.ok) {
        toast.success(`Added “${pattern}”`);
        setKwInput("");
        await refresh();
      } else toast.error("Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: string, label: string) {
    setBusy(true);
    try {
      const res = await proxy(`/api/signals/rules/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`Removed “${label}”`);
        await refresh();
      } else toast.error("Remove failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(r: SignalRuleItem) {
    setBusy(true);
    try {
      const res = await proxy(`/api/signals/rules/${r.id}`, {
        method: "PATCH",
        body: { enabled: !r.enabled },
      });
      if (res.ok) {
        toast.success(r.enabled ? "Disabled" : "Enabled");
        await refresh();
      } else toast.error("Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* Left: groups like Keywords tags list */}
      <Card className="overflow-hidden lg:col-span-4">
        <CardHeader className="border-b border-border/60 py-3">
          <CardTitle className="text-sm">Groups</CardTitle>
          <CardDescription className="text-xs">
            Generic keywords apply to every tag. Tag groups add extras (like Keywords).
          </CardDescription>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter groups / keywords…"
            className="mt-2 h-8 text-xs"
          />
        </CardHeader>
        <CardContent className="p-2">
          <ul className="max-h-[min(28rem,60vh)] space-y-0.5 overflow-y-auto">
            {groupList.map((k) => {
              const count = groups.get(k)?.length ?? 0;
              const on = selected === k;
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => setSelected(k)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm",
                      on
                        ? "bg-primary/10 font-medium ring-1 ring-primary/30"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <span className="truncate">{displayGroup(k)}</span>
                    <Badge variant="muted" className="tabular-nums text-[10px]">
                      {count}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Right: keyword chips like Keywords manager */}
      <Card className="lg:col-span-8">
        <CardHeader className="border-b border-border/60 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">{displayGroup(selected)}</CardTitle>
              <CardDescription className="mt-1">
                {activeRules.length} keyword{activeRules.length === 1 ? "" : "s"} stored ·
                matched on new posts → Telegram
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1">
              {canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void seed()}
                >
                  <Database className="size-3.5" />
                  Seed defaults
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {canWrite ? (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <span className="text-[10px] uppercase text-muted-foreground">
                  Add keyword
                </span>
                <Input
                  value={kwInput}
                  onChange={(e) => {
                    setKwInput(e.target.value);
                    setKwCategory(inferCategory(e.target.value));
                  }}
                  placeholder="e.g. mint live, wl application"
                  className="h-9 font-mono text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addKeyword();
                  }}
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] uppercase text-muted-foreground">Category</span>
                <select
                  value={kwCategory}
                  onChange={(e) => setKwCategory(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex h-9 items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={isRegex}
                  onChange={(e) => setIsRegex(e.target.checked)}
                />
                regex
              </label>
              <Button
                type="button"
                size="sm"
                className="h-9"
                disabled={busy || !kwInput.trim()}
                onClick={() => void addKeyword()}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
          ) : null}

          {activeRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No keywords in this group yet. Seed defaults or add chips above — same idea as
              Keywords page.
            </p>
          ) : (
            <div className="space-y-4">
              {CATEGORIES.map((cat) => {
                const list = byCategory.get(cat) ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        {cat}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {list.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((r) => (
                        <span
                          key={r.id}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs",
                            r.enabled
                              ? cat === "mint"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                                : cat === "wl"
                                  ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
                                  : "border-border bg-muted/40"
                              : "border-border/50 bg-muted/20 text-muted-foreground line-through opacity-60",
                          )}
                          title={r.isRegex ? `regex: ${r.pattern}` : r.pattern}
                        >
                          {r.pattern}
                          {r.isRegex ? (
                            <span className="text-[9px] uppercase opacity-70">re</span>
                          ) : null}
                          {canWrite ? (
                            <>
                              <button
                                type="button"
                                className="rounded-full p-0.5 text-muted-foreground hover:bg-background/80"
                                title={r.enabled ? "Disable" : "Enable"}
                                disabled={busy}
                                onClick={() => void toggleRule(r)}
                              >
                                <Power className="size-3" />
                              </button>
                              <button
                                type="button"
                                className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                                aria-label={`Remove ${r.pattern}`}
                                disabled={busy}
                                onClick={() => void removeRule(r.id, r.pattern)}
                              >
                                <X className="size-3" />
                              </button>
                            </>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            These keywords are already stored in the database and used by HomeLatest + list
            signal detection. New post text is matched → Telegram <strong>signal</strong> alert.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
