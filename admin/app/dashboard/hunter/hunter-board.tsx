"use client";

import { useCallback, useState } from "react";
import {
  Crosshair,
  Flame,
  RefreshCw,
  ExternalLink,
  Loader2,
  X,
  Radar,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { fmtDate, fmtNum, type HotBoardItem, type HuntStage } from "@/lib/types";
import { cn } from "@/lib/cn";

const STAGE_STYLE: Record<string, string> = {
  noise: "bg-muted text-muted-foreground",
  soft: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  hot: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  skip: "bg-destructive/15 text-destructive",
  taken: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

type EntityPayload = {
  account: {
    id: string;
    username: string;
    name: string;
    description: string | null;
    tags: string[];
    followersCount: number | null;
    followingCount: number | null;
    isBlueVerified: boolean | null;
    createdAt: string | null;
    firstSeenAt: string;
    huntStage: string;
    huntNote: string | null;
    accountAgeDays: number | null;
  };
  lists: { slug: string; name: string }[];
  seedFollows: { seed: string; category: string; firstSeenAt: string }[];
  watchFollows: { watcher: string; sentAt: string }[];
  convergenceAlerts: {
    type: string;
    score: number;
    seedUsernames: string[];
    reason: string;
    createdAt: string;
  }[];
  searchHits: { tweetId: string; text: string; query: string; createdAt: string }[];
  researchRuns: {
    id: string;
    title: string | null;
    status: string;
    excerpt: string | null;
    createdAt: string;
  }[];
};

export function HunterBoard({
  initialItems,
  initialHours,
  pipeline,
  stages,
}: {
  initialItems: HotBoardItem[];
  initialHours: number;
  pipeline: Record<string, number>;
  stages: string[];
}) {
  const canWrite = useCan("editor");
  const [items, setItems] = useState(initialItems);
  const [hours, setHours] = useState(String(initialHours));
  const [tag, setTag] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [maxAgeDays, setMaxAgeDays] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [minHeat, setMinHeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [pipe, setPipe] = useState(pipeline);
  const [selected, setSelected] = useState<string | null>(null);
  const [entity, setEntity] = useState<EntityPayload | null>(null);
  const [entityBusy, setEntityBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ hours: hours || "72", limit: "50" });
      if (tag.trim()) q.set("tag", tag.trim().toLowerCase());
      if (maxFollowers.trim()) q.set("maxFollowers", maxFollowers.trim());
      if (maxAgeDays.trim()) q.set("maxAgeDays", maxAgeDays.trim());
      if (stageFilter) q.set("stage", stageFilter);
      if (minHeat.trim()) q.set("minHeat", minHeat.trim());

      const [hotRes, pipeRes] = await Promise.all([
        proxy(`/api/hunter/hot?${q}`),
        proxy("/api/hunter/pipeline"),
      ]);
      if (hotRes.ok) {
        const body = hotRes.body as { items: HotBoardItem[] };
        setItems(body.items);
      } else toast.error("Failed to load hot board");
      if (pipeRes.ok) {
        const body = pipeRes.body as { counts: Record<string, number> };
        setPipe(body.counts);
      }
    } finally {
      setBusy(false);
    }
  }, [hours, tag, maxFollowers, maxAgeDays, stageFilter, minHeat]);

  async function openEntity(id: string) {
    setSelected(id);
    setEntityBusy(true);
    setEntity(null);
    try {
      const res = await proxy(`/api/hunter/entity/${encodeURIComponent(id)}`);
      if (res.ok) {
        const body = res.body as EntityPayload;
        setEntity(body);
        setNoteDraft(body.account.huntNote ?? "");
      } else toast.error("Failed to load entity");
    } finally {
      setEntityBusy(false);
    }
  }

  async function monitorTweets(username: string, accountId: string, heat?: number) {
    setBusy(true);
    try {
      const res = await proxy("/api/monitors", {
        method: "POST",
        body: {
          username,
          twitterUserId: accountId,
          source: "manual",
          alertMode: "all",
          heatAtEnroll: heat ?? null,
        },
      });
      if (res.ok) {
        toast.success(`Live monitoring @${username} (every post → Telegram)`);
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? "Monitor failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function setStage(accountId: string, stage: HuntStage) {
    if (!canWrite) return;
    const res = await proxy(`/api/hunter/entity/${encodeURIComponent(accountId)}/stage`, {
      method: "PATCH",
      body: { stage, note: noteDraft || null },
    });
    if (res.ok) {
      toast.success(`Stage → ${stage}`);
      setItems((prev) =>
        prev.map((i) =>
          i.accountId === accountId
            ? { ...i, huntStage: stage, huntNote: noteDraft || null }
            : i,
        ),
      );
      if (entity?.account.id === accountId) {
        setEntity({
          ...entity,
          account: {
            ...entity.account,
            huntStage: stage,
            huntNote: noteDraft || null,
          },
        });
      }
      void refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? "Stage update failed");
    }
  }

  return (
    <div className="space-y-4">
      {/* Pipeline strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stages.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStageFilter((prev) => (prev === s ? "" : s));
            }}
            className={cn(
              "rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40",
              stageFilter === s && "ring-2 ring-primary/40",
            )}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {s}
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {pipe[s] ?? 0}
            </div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Flame className="size-4 text-orange-500" />
            Hot board
          </CardTitle>
          <CardDescription>
            Ranked by multi-source heat: seed follows, watchlist convergence, search
            hits, young accounts. Click a row for fused evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="hours"
              className="w-full sm:w-24"
              inputMode="numeric"
            />
            <Input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="tag e.g. nft"
              className="w-full font-mono sm:w-32"
            />
            <Input
              value={maxFollowers}
              onChange={(e) => setMaxFollowers(e.target.value)}
              placeholder="max followers"
              className="w-full sm:w-32"
              inputMode="numeric"
            />
            <Input
              value={maxAgeDays}
              onChange={(e) => setMaxAgeDays(e.target.value)}
              placeholder="max age days"
              className="w-full sm:w-32"
              inputMode="numeric"
            />
            <Input
              value={minHeat}
              onChange={(e) => setMinHeat(e.target.value)}
              placeholder="min heat"
              className="w-full sm:w-24"
              inputMode="numeric"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Apply
            </Button>
          </div>

          {items.length === 0 ? (
            <EmptyState
              title="Nothing hot in this window"
              description="Track more seeds/watchlist or widen hours. New first-seen projects also appear here."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2">Heat</th>
                    <th className="px-2 py-2">Account</th>
                    <th className="px-2 py-2">Signals</th>
                    <th className="px-2 py-2">Age / flw</th>
                    <th className="px-2 py-2">Stage</th>
                    <th className="px-2 py-2">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr
                      key={row.accountId}
                      className={cn(
                        "cursor-pointer border-b border-border/50 hover:bg-muted/30",
                        selected === row.accountId && "bg-primary/5",
                      )}
                      onClick={() => void openEntity(row.accountId)}
                    >
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-orange-600 dark:text-orange-400">
                          <Flame className="size-3.5" />
                          {row.heat}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-medium">
                          <a
                            href={`https://x.com/${row.username}`}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            @{row.username}
                          </a>
                          {row.isBlueVerified ? (
                            <span className="ml-1 text-primary">✓</span>
                          ) : null}
                        </div>
                        <div className="max-w-[12rem] truncate text-xs text-muted-foreground">
                          {row.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-0.5">
                          {row.tags.slice(0, 3).map((t) => (
                            <Badge key={t} variant="muted" className="text-[10px]">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <div>
                          seeds <strong>{row.seedCount}</strong>
                          {row.seedUsernames.length ? (
                            <span className="text-muted-foreground">
                              {" "}
                              ({row.seedUsernames.slice(0, 3).join(", ")})
                            </span>
                          ) : null}
                        </div>
                        <div>
                          watch <strong>{row.watcherCount}</strong>
                          {row.watcherUsernames.length ? (
                            <span className="text-muted-foreground">
                              {" "}
                              ({row.watcherUsernames.slice(0, 3).join(", ")})
                            </span>
                          ) : null}
                        </div>
                        <div>
                          search <strong>{row.searchHits}</strong>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">
                        <div>
                          {row.accountAgeDays != null
                            ? `${row.accountAgeDays}d old`
                            : "age ?"}
                        </div>
                        <div>{fmtNum(row.followersCount)} flw</div>
                        <div className="text-[10px]">
                          {fmtDate(row.lastSignalAt)}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                            STAGE_STYLE[row.huntStage] ?? STAGE_STYLE.noise,
                          )}
                        >
                          {row.huntStage}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex max-w-[10rem] flex-wrap gap-0.5">
                          {row.sources.map((s) => (
                            <Badge key={s} variant="secondary" className="text-[9px]">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entity drawer */}
      {selected ? (
        <Card className="border-primary/30">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Crosshair className="size-4" />
                Entity
                {entity ? (
                  <a
                    href={`https://x.com/${entity.account.username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    @{entity.account.username}
                  </a>
                ) : null}
              </CardTitle>
              <CardDescription>
                Fused evidence: seeds · watchers · search · lists · research
              </CardDescription>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => {
                setSelected(null);
                setEntity(null);
              }}
            >
              <X className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {entityBusy || !entity ? (
              <p className="text-sm text-muted-foreground">
                {entityBusy ? "Loading…" : "No data"}
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="font-medium">{entity.account.name}</div>
                    <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                      {entity.account.description || "(no bio)"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {entity.account.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {fmtNum(entity.account.followersCount)} flw · age{" "}
                      {entity.account.accountAgeDays != null
                        ? `${entity.account.accountAgeDays}d`
                        : "?"}{" "}
                      · first seen {fmtDate(entity.account.firstSeenAt)}
                    </div>
                  </div>

                  {canWrite ? (
                    <div className="space-y-2 rounded-lg border border-border p-3">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Funnel stage
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(["noise", "soft", "hot", "skip", "taken"] as HuntStage[]).map(
                          (s) => (
                            <Button
                              key={s}
                              type="button"
                              size="sm"
                              variant={
                                entity.account.huntStage === s ? "default" : "outline"
                              }
                              className="h-7 capitalize"
                              onClick={() => void setStage(entity.account.id, s)}
                            >
                              {s}
                            </Button>
                          ),
                        )}
                      </div>
                      <Input
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Hunt note (why soft/hot/skip…)"
                        className="text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Note is saved with the next stage click. Stage does not
                        auto-monitor — use the button below if you want tweets.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="w-full"
                        disabled={busy}
                        onClick={() =>
                          void monitorTweets(
                            entity.account.username,
                            entity.account.id,
                          )
                        }
                      >
                        <Radar className="size-3.5" />
                        Monitor this user → Telegram
                      </Button>
                    </div>
                  ) : null}

                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Lists
                    </div>
                    {entity.lists.length === 0 ? (
                      <p className="text-xs text-muted-foreground">None</p>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {entity.lists.map((l) => (
                          <Badge key={l.slug} variant="secondary">
                            {l.slug}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="max-h-[28rem] space-y-3 overflow-y-auto text-xs">
                  <Section title="Seed follows">
                    {entity.seedFollows.length === 0 ? (
                      <EmptyLine />
                    ) : (
                      entity.seedFollows.map((s, i) => (
                        <div key={i}>
                          @{s.seed}{" "}
                          <span className="text-muted-foreground">
                            ({s.category}) · {fmtDate(s.firstSeenAt)}
                          </span>
                        </div>
                      ))
                    )}
                  </Section>
                  <Section title="Watchlist follows">
                    {entity.watchFollows.length === 0 ? (
                      <EmptyLine />
                    ) : (
                      entity.watchFollows.map((w, i) => (
                        <div key={i}>
                          @{w.watcher}{" "}
                          <span className="text-muted-foreground">
                            · {fmtDate(w.sentAt)}
                          </span>
                        </div>
                      ))
                    )}
                  </Section>
                  <Section title="Convergence alerts">
                    {entity.convergenceAlerts.length === 0 ? (
                      <EmptyLine />
                    ) : (
                      entity.convergenceAlerts.map((a, i) => (
                        <div key={i}>
                          score {a.score} · {a.seedUsernames.join(", ")} ·{" "}
                          {a.reason}
                        </div>
                      ))
                    )}
                  </Section>
                  <Section title="Search hits">
                    {entity.searchHits.length === 0 ? (
                      <EmptyLine />
                    ) : (
                      entity.searchHits.map((h) => (
                        <div key={h.tweetId} className="border-b border-border/40 py-1">
                          <span className="text-muted-foreground">{h.query}</span>
                          <div className="line-clamp-2">{h.text}</div>
                          <a
                            href={`https://x.com/i/status/${h.tweetId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            post <ExternalLink className="size-3" />
                          </a>
                        </div>
                      ))
                    )}
                  </Section>
                  <Section title="Grok research">
                    {entity.researchRuns.length === 0 ? (
                      <EmptyLine />
                    ) : (
                      entity.researchRuns.map((r) => (
                        <div key={r.id} className="border-b border-border/40 py-1">
                          <div className="font-medium">
                            {r.title ?? r.id} · {r.status}
                          </div>
                          {r.excerpt ? (
                            <p className="line-clamp-3 text-muted-foreground">
                              {r.excerpt}
                            </p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </Section>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function EmptyLine() {
  return <p className="text-muted-foreground">—</p>;
}
