"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Crosshair,
  ExternalLink,
  Loader2,
  Radar,
  RefreshCw,
  Layers,
  List,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { cn } from "@/lib/cn";
import { fmtDate, type SignalPost } from "@/lib/types";

export function SignalsTable({
  items: initialItems,
  slug,
  since,
}: {
  items: SignalPost[];
  slug: string;
  since: string;
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [items, setItems] = useState(initialItems);
  const [loading, setLoading] = useState(false);
  const [groupByTag, setGroupByTag] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [slugFilter, setSlugFilter] = useState(slug);
  const [sinceFilter, setSinceFilter] = useState(since || "all");

  const refresh = useCallback(
    async (opts?: { slug?: string; since?: string }) => {
      const s = opts?.slug ?? slugFilter;
      const w = opts?.since ?? sinceFilter;
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (s.trim()) qs.set("slug", s.trim());
        if (w && w !== "all") qs.set("since", w);
        qs.set("limit", s.trim() ? "20" : "200");
        qs.set("perTag", s.trim() ? "0" : "1");
        const res = await proxy(`/api/signals?${qs.toString()}`);
        if (res.ok) {
          const body = res.body as { items?: SignalPost[] };
          setItems(body.items ?? []);
        } else {
          toast.error("Failed to refresh feed");
        }
      } finally {
        setLoading(false);
      }
    },
    [slugFilter, sinceFilter],
  );

  function applyFilter(next: { slug?: string; since?: string }) {
    const s = next.slug ?? slugFilter;
    const w = next.since ?? sinceFilter;
    setSlugFilter(s);
    setSinceFilter(w);
    const params = new URLSearchParams();
    if (s) params.set("slug", s);
    if (w && w !== "all") params.set("since", w);
    else if (w === "all") params.set("since", "all");
    router.replace(`/dashboard/signals?${params.toString()}`);
    void refresh({ slug: s, since: w });
  }

  const groups = useMemo(() => {
    const map = new Map<string, SignalPost[]>();
    for (const p of items) {
      const key = p.slug || "unknown";
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  async function promote(
    post: SignalPost,
    action: "monitor" | "hunt",
    stage?: string,
  ) {
    const key = `${action}-${post.tweetId}`;
    setBusyKey(key);
    try {
      const res = await proxy("/api/signals/promote", {
        method: "POST",
        body: {
          username: post.username,
          accountId: post.accountId,
          action,
          stage: stage ?? "soft",
          slug: post.slug,
          tweetId: post.tweetId,
          alertMode: "signals",
        },
      });
      if (res.ok) {
        const b = res.body as { already?: boolean; stage?: string };
        if (action === "monitor") {
          toast.success(
            b.already
              ? `@${post.username} already monitored`
              : `Monitoring @${post.username} (signals mode)`,
          );
        } else {
          toast.success(
            `@${post.username} → hunter ${b.stage ?? stage ?? "soft"}`,
          );
        }
      } else {
        const err = (res.body as { error?: string } | null)?.error ?? "Failed";
        toast.error(err);
      }
    } finally {
      setBusyKey(null);
    }
  }

  function PostRow({ post }: { post: SignalPost }) {
    const monBusy = busyKey === `monitor-${post.tweetId}`;
    const huntBusy = busyKey === `hunt-${post.tweetId}`;
    return (
      <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <a
              href={`https://x.com/${post.username}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              @{post.username}
            </a>
            {!groupByTag ? <Badge className="text-[10px]">{post.slug}</Badge> : null}
            {post.signals.map((s) => (
              <Badge key={s} variant="success" className="text-[10px]">
                {s}
              </Badge>
            ))}
            <a
              href={`https://x.com/${post.username}/status/${post.tweetId}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground"
              title="Open post"
            >
              <ExternalLink className="size-3" />
            </a>
            <span className="text-[11px] text-muted-foreground">
              {fmtDate(post.postedAt ?? post.createdAt)}
            </span>
          </div>
          <a
            href={`https://x.com/${post.username}/status/${post.tweetId}`}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 block text-sm text-muted-foreground hover:text-foreground"
          >
            {post.text}
          </a>
        </div>
        {canWrite ? (
          <div className="flex shrink-0 flex-wrap gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!!busyKey}
              title="Add user timeline monitor (signals mode)"
              onClick={() => void promote(post, "monitor")}
            >
              {monBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Radar className="size-3.5" />
              )}
              Monitor
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8"
              disabled={!!busyKey}
              title="Mark soft on hunter board"
              onClick={() => void promote(post, "hunt", "soft")}
            >
              {huntBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Crosshair className="size-3.5" />
              )}
              Soft
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={!!busyKey}
              title="Mark hot on hunter board"
              onClick={() => void promote(post, "hunt", "hot")}
            >
              Hot
            </Button>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Signal feed</CardTitle>
              <CardDescription>
                Latest 20 posts per tag in storage. Promote to{" "}
                <strong>User Monitor</strong> or <strong>Hunter</strong> stages.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant={groupByTag ? "secondary" : "outline"}
                className="h-8"
                onClick={() => setGroupByTag(true)}
              >
                <Layers className="size-3.5" />
                By tag
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!groupByTag ? "secondary" : "outline"}
                className="h-8"
                onClick={() => setGroupByTag(false)}
              >
                <List className="size-3.5" />
                Flat
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={loading}
                onClick={() => void refresh()}
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">
                Tag
              </span>
              <Input
                value={slugFilter}
                onChange={(e) => setSlugFilter(e.target.value)}
                placeholder="all tags"
                className="h-9 w-32"
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    applyFilter({ slug: (e.target as HTMLInputElement).value });
                }}
              />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase text-muted-foreground">
                Window
              </span>
              <Select
                value={sinceFilter || "all"}
                onValueChange={(v) => applyFilter({ since: v })}
              >
                <SelectTrigger className="h-9 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">stored</SelectItem>
                  <SelectItem value="6h">6h</SelectItem>
                  <SelectItem value="24h">24h</SelectItem>
                  <SelectItem value="48h">48h</SelectItem>
                  <SelectItem value="7d">7d</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              onClick={() => applyFilter({ slug: slugFilter })}
            >
              Apply
            </Button>
            <span className="pb-1 text-xs text-muted-foreground">
              {items.length} post{items.length === 1 ? "" : "s"}
              {groupByTag ? ` · ${groups.length} tag${groups.length === 1 ? "" : "s"}` : ""}
            </span>
          </div>

          {loading && items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading feed…
            </p>
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No stored signal posts (latest 20 per tag). Follow projects and poll
              HomeLatest.
            </p>
          ) : groupByTag ? (
            <div className="space-y-3">
              {groups.map(([tag, posts]) => (
                <div
                  key={tag}
                  className="overflow-hidden rounded-lg border border-border"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Badge>{tag}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {posts.length} / 20
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => applyFilter({ slug: tag })}
                    >
                      Filter tag
                    </Button>
                  </div>
                  <ul className="divide-y divide-border">
                    {posts.map((p) => (
                      <PostRow key={p.tweetId} post={p} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul
              className={cn(
                "max-h-[min(36rem,70vh)] divide-y divide-border overflow-y-auto rounded-lg border border-border",
              )}
            >
              {items.map((p) => (
                <PostRow key={p.tweetId} post={p} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
