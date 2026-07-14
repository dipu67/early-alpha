"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  Radio,
  Settings2,
  ListFilter,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { cn } from "@/lib/cn";
import { fmtDate, fmtNum, type AuthAccount, type SignalPost } from "@/lib/types";
import { TopicPicker } from "@/components/topic-picker";
import { SignalsTable } from "./page-table";
import { SignalRulesPanel } from "./signal-rules-panel";

type TagProject = {
  id: string;
  username: string;
  name: string;
  tags: string[];
  followersCount: number | null;
  isBlueVerified: boolean | null;
  firstSeenAt: string;
};

export type SignalScanItem = {
  id: string;
  tagSlug: string;
  authAccountId: string;
  authUsername: string | null;
  enabled: boolean;
  autoFollow: boolean;
  alertEnabled: boolean;
  topicId: number | null;
  intervalSec: number;
  lastTweetId: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  hitCount: number;
};

export type SignalRuleItem = {
  id: string;
  slug: string | null;
  category: string;
  label: string;
  pattern: string;
  isRegex: boolean;
  enabled: boolean;
};

export type AuthFollowItem = {
  id: string;
  authAccountId: string;
  authUsername: string | null;
  twitterUserId: string;
  username: string;
  tagSlug: string | null;
  source: string;
  createdAt: string;
};

type Tab = "feed" | "scans" | "rules" | "follows";

/** Per-scanner min seconds between HomeLatest polls (job still ticks ~2m). */
const POLL_INTERVAL_OPTIONS: { sec: number; label: string }[] = [
  { sec: 60, label: "1 min" },
  { sec: 120, label: "2 min" },
  { sec: 180, label: "3 min" },
  { sec: 300, label: "5 min" },
  { sec: 600, label: "10 min" },
  { sec: 900, label: "15 min" },
  { sec: 1800, label: "30 min" },
  { sec: 3600, label: "1 hour" },
];

/** Unfollowed projects shown / appended per page (Follow tab). */
const PROJECT_PAGE_SIZE = 20;
/** API batch size when filling a page (skips already-followed). */
const PROJECT_FETCH_BATCH = 40;

function formatInterval(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

export function SignalsDesk({
  feed,
  feedSlug,
  feedSince,
  scans: initialScans,
  rules: initialRules,
  follows: initialFollows,
  authAccounts,
  tags,
}: {
  feed: SignalPost[];
  feedSlug: string;
  feedSince: string;
  scans: SignalScanItem[];
  rules: SignalRuleItem[];
  follows: AuthFollowItem[];
  authAccounts: AuthAccount[];
  tags: { slug: string; label?: string }[];
}) {
  const canWrite = useCan("editor");
  const [tab, setTab] = useState<Tab>("feed");
  const [scans, setScans] = useState(initialScans);
  const [rules, setRules] = useState(initialRules);
  const [follows, setFollows] = useState(initialFollows);
  const [busy, setBusy] = useState(false);

  // New scan form
  const [tagSlug, setTagSlug] = useState(tags[0]?.slug ?? "nft");
  const [authId, setAuthId] = useState(authAccounts[0]?.id ?? "");
  const [autoFollow, setAutoFollow] = useState(false);
  const [intervalSec, setIntervalSec] = useState(120);
  const [createTopicId, setCreateTopicId] = useState("");

  // Manual follow by tag — list projects with that tag
  const [followTag, setFollowTag] = useState(
    initialScans[0]?.tagSlug ?? tags[0]?.slug ?? "nft",
  );
  const [followAuthId, setFollowAuthId] = useState(
    initialScans[0]?.authAccountId ?? authAccounts.find((a) => a.isActive)?.id ?? "",
  );
  const [followUser, setFollowUser] = useState("");
  /**
   * Project queue for Follow tab.
   * Initial / Refresh loads page 1; Load more appends.
   * Follow never reloads — rows stay put and flip to "Following".
   */
  const [projectQueue, setProjectQueue] = useState<TagProject[]>([]);
  const [tagProjectsTotal, setTagProjectsTotal] = useState(0);
  /** Next API offset after last successful fetch. */
  const [projectOffset, setProjectOffset] = useState(0);
  const [hasMoreProjects, setHasMoreProjects] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [followingId, setFollowingId] = useState<string | null>(null);

  const followedIds = useMemo(
    () => new Set(follows.map((f) => f.twitterUserId)),
    [follows],
  );
  const followedUsernames = useMemo(
    () => new Set(follows.map((f) => f.username.toLowerCase())),
    [follows],
  );

  function isFollowed(p: TagProject): boolean {
    return (
      followedIds.has(p.id) ||
      followedUsernames.has(p.username.toLowerCase())
    );
  }

  /**
   * Pull unfollowed projects from the API, filling up to `want` items
   * by walking offset pages (skips already-followed / already-in-queue).
   */
  async function fetchUnfollowedPage(opts: {
    tag: string;
    search: string;
    startOffset: number;
    want: number;
    excludeIds: Set<string>;
    excludeNames: Set<string>;
    alreadyInQueue: Set<string>;
  }): Promise<{
    items: TagProject[];
    total: number;
    nextOffset: number;
    hasMore: boolean;
  }> {
    const collected: TagProject[] = [];
    let offset = opts.startOffset;
    let total = 0;
    let safety = 0;

    while (collected.length < opts.want && safety < 8) {
      safety += 1;
      const qs = new URLSearchParams({
        tag: opts.tag,
        limit: String(PROJECT_FETCH_BATCH),
        offset: String(offset),
        sort: "latest",
      });
      if (opts.search.trim()) qs.set("search", opts.search.trim());
      const res = await proxy(`/api/projects?${qs.toString()}`);
      if (!res.ok) break;
      const body = res.body as { items?: TagProject[]; total?: number };
      const batch = body.items ?? [];
      total = body.total ?? total;
      if (batch.length === 0) {
        offset = Math.max(offset, total);
        break;
      }
      for (const p of batch) {
        if (opts.alreadyInQueue.has(p.id)) continue;
        if (opts.excludeIds.has(p.id)) continue;
        if (opts.excludeNames.has(p.username.toLowerCase())) continue;
        if (collected.some((c) => c.id === p.id)) continue;
        collected.push(p);
        if (collected.length >= opts.want) break;
      }
      offset += batch.length;
      if (batch.length < PROJECT_FETCH_BATCH || offset >= total) break;
    }

    return {
      items: collected,
      total,
      nextOffset: offset,
      hasMore: offset < total,
    };
  }

  /**
   * Reset queue and load first page (Refresh / tag change / first open).
   * Follow never calls this.
   */
  const loadTagProjects = useCallback(async (tag: string, search = "") => {
    if (!tag) {
      setProjectQueue([]);
      setTagProjectsTotal(0);
      setProjectOffset(0);
      setHasMoreProjects(false);
      return;
    }
    setLoadingProjects(true);
    try {
      let liveFollows: AuthFollowItem[] = [];
      const fRes = await proxy("/api/signals/auth-follows");
      if (fRes.ok) {
        const items = (fRes.body as { items?: AuthFollowItem[] }).items ?? [];
        liveFollows = items.filter(
          (f) => f && typeof f.username === "string" && f.id,
        );
        setFollows(liveFollows);
      }

      const excludeIds = new Set(liveFollows.map((f) => f.twitterUserId));
      const excludeNames = new Set(
        liveFollows.map((f) => f.username.toLowerCase()),
      );
      const page = await fetchUnfollowedPage({
        tag,
        search,
        startOffset: 0,
        want: PROJECT_PAGE_SIZE,
        excludeIds,
        excludeNames,
        alreadyInQueue: new Set(),
      });
      setProjectQueue(page.items);
      setTagProjectsTotal(page.total);
      setProjectOffset(page.nextOffset);
      setHasMoreProjects(page.hasMore);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  /** Append next page of unfollowed projects (Load more). */
  const loadMoreProjects = useCallback(async () => {
    if (!followTag || !hasMoreProjects || loadingMore || loadingProjects) return;
    setLoadingMore(true);
    try {
      const excludeIds = new Set(follows.map((f) => f.twitterUserId));
      const excludeNames = new Set(
        follows.map((f) => f.username.toLowerCase()),
      );
      const alreadyInQueue = new Set(projectQueue.map((p) => p.id));
      const page = await fetchUnfollowedPage({
        tag: followTag,
        search: projectSearch,
        startOffset: projectOffset,
        want: PROJECT_PAGE_SIZE,
        excludeIds,
        excludeNames,
        alreadyInQueue,
      });
      if (page.items.length > 0) {
        setProjectQueue((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const extra = page.items.filter((p) => !seen.has(p.id));
          return extra.length ? [...prev, ...extra] : prev;
        });
      }
      setTagProjectsTotal(page.total);
      setProjectOffset(page.nextOffset);
      setHasMoreProjects(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [
    followTag,
    hasMoreProjects,
    loadingMore,
    loadingProjects,
    follows,
    projectQueue,
    projectSearch,
    projectOffset,
  ]);

  // First open of Follow tab only (tag change loads via onFollowTagChange)
  useEffect(() => {
    if (
      tab === "follows" &&
      followTag &&
      projectQueue.length === 0 &&
      !loadingProjects
    ) {
      void loadTagProjects(followTag, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only bootstrap when empty
  }, [tab]);

  const [pendingDelete, setPendingDelete] = useState<{
    kind: "scan" | "follow";
    id: string;
    label: string;
  } | null>(null);

  async function refreshScans() {
    const res = await proxy("/api/signals/scans");
    if (res.ok) setScans((res.body as { items: SignalScanItem[] }).items ?? []);
  }
  async function refreshFollows() {
    const res = await proxy("/api/signals/auth-follows");
    if (res.ok) {
      const items = (res.body as { items?: AuthFollowItem[] }).items ?? [];
      setFollows(
        items.filter((f) => f && typeof f.username === "string" && f.id),
      );
    }
  }

  async function saveScan() {
    if (!tagSlug || !authId) {
      toast.error("Tag + auth account required");
      return;
    }
    setBusy(true);
    try {
      const topicNum =
        createTopicId.trim() === "" ? null : Number(createTopicId);
      const res = await proxy("/api/signals/scans", {
        method: "POST",
        body: {
          tagSlug,
          authAccountId: authId,
          autoFollow,
          intervalSec,
          topicId:
            topicNum != null && Number.isFinite(topicNum) ? topicNum : null,
          enabled: true,
          alertEnabled: true,
        },
      });
      if (res.ok) {
        toast.success(`Scanner for ${tagSlug} → auth bound`);
        await refreshScans();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? "Save failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function patchScan(id: string, body: Record<string, unknown>, msg?: string) {
    setBusy(true);
    try {
      const res = await proxy(`/api/signals/scans/${id}`, { method: "PATCH", body });
      if (res.ok) {
        if (msg) toast.success(msg);
        await refreshScans();
      } else toast.error("Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function pollScan(id: string, tag: string) {
    setBusy(true);
    try {
      const res = await proxy(`/api/signals/scans/${id}/poll`, {
        method: "POST",
        body: {},
      });
      if (res.ok) {
        const r = res.body as {
          seeded?: boolean;
          fresh?: number;
          alerted?: number;
          error?: string;
        };
        if (r.error) toast.error(r.error);
        else if (r.seeded) toast.success(`${tag}: watermark seeded (no history flood)`);
        else toast.success(`${tag}: ${r.fresh ?? 0} new · ${r.alerted ?? 0} signals`);
        await refreshScans();
      } else toast.error("Poll failed");
    } finally {
      setBusy(false);
    }
  }

  async function pollAll() {
    setBusy(true);
    try {
      const res = await proxy("/api/signals/scans/poll-all", { method: "POST", body: {} });
      if (res.ok) toast.success("HomeLatest scan job enqueued");
      else toast.error("Enqueue failed");
    } finally {
      setBusy(false);
    }
  }

  function onFollowTagChange(tag: string) {
    setFollowTag(tag);
    setProjectSearch("");
    const bound = scans.find((s) => s.tagSlug === tag);
    if (bound?.authAccountId) setFollowAuthId(bound.authAccountId);
    void loadTagProjects(tag, "");
  }

  async function followProject(opts: {
    username: string;
    twitterUserId?: string;
  }) {
    const u = opts.username.trim().replace(/^@/, "").toLowerCase();
    if (!u || !followTag) {
      toast.error("Username + tag required");
      return;
    }
    if (!followAuthId) {
      toast.error(
        `Pick an auth account for tag “${followTag}” (or bind Tag → Auth first).`,
      );
      return;
    }
    setFollowingId(opts.twitterUserId ?? u);
    setBusy(true);
    try {
      const res = await proxy("/api/signals/auth-follows", {
        method: "POST",
        body: {
          username: u,
          tagSlug: followTag,
          authAccountId: followAuthId,
          ...(opts.twitterUserId ? { twitterUserId: opts.twitterUserId } : {}),
        },
      });
      if (res.ok) {
        const b = res.body as {
          authUsername?: string;
          id?: string;
          twitterUserId?: string;
        };
        toast.success(
          `Followed @${u}` +
            (b.authUsername ? ` with @${b.authUsername}` : ""),
        );
        setFollowUser("");
        // Local-only: mark as following + add to "Already following".
        // Do NOT call loadTagProjects — queue reloads only on Refresh list.
        setFollows((prev) => {
          const id = b.twitterUserId ?? opts.twitterUserId ?? "";
          const uname = u.toLowerCase();
          if (
            prev.some(
              (f) =>
                (id && f.twitterUserId === id) ||
                f.username.toLowerCase() === uname,
            )
          ) {
            return prev;
          }
          return [
            {
              id: b.id ?? `local-${Date.now()}`,
              authAccountId: followAuthId,
              authUsername:
                b.authUsername ??
                authAccounts.find((a) => a.id === followAuthId)?.username ??
                null,
              twitterUserId: id || uname,
              username: uname,
              tagSlug: followTag,
              source: "manual",
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ];
        });
      } else {
        const b = res.body as { error?: string } | null;
        const err = b?.error ?? "Follow failed";
        toast.error(
          err.includes("no_signal_scan") || err.includes("No auth bound")
            ? `No auth for “${followTag}”. Select an auth account or bind Tag → Auth.`
            : err,
        );
      }
    } finally {
      setBusy(false);
      setFollowingId(null);
    }
  }

  async function manualFollow() {
    await followProject({ username: followUser });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const path =
        pendingDelete.kind === "scan"
          ? `/api/signals/scans/${pendingDelete.id}`
          : `/api/signals/auth-follows/${pendingDelete.id}`;
      const res = await proxy(path, { method: "DELETE" });
      if (res.ok) {
        toast.success("Deleted");
        setPendingDelete(null);
        if (pendingDelete.kind === "scan") await refreshScans();
        if (pendingDelete.kind === "follow") await refreshFollows();
      } else toast.error("Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Radio }[] = [
    { id: "feed", label: "Feed", icon: Radio },
    { id: "scans", label: "Tag → Auth", icon: Settings2 },
    { id: "follows", label: "Follow projects", icon: UserPlus },
    { id: "rules", label: "Rules", icon: ListFilter },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm sm:flex-none",
                on
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-background/60",
              )}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "feed" ? (
        <SignalsTable items={feed} slug={feedSlug} since={feedSince} />
      ) : null}

      {tab === "scans" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">How it works</CardTitle>
              <CardDescription>
                1) Bind auth account to a tag (e.g. nft). 2) Manually follow early projects
                with that auth (Follow tab). 3) Poller runs{" "}
                <code className="text-[11px]">getHomeLatestTimeline</code> — only tweets
                with id &gt; lastTweetId. 4) Rules (mint, wl, …) fire → Signals feed +
                Telegram. Auto-follow stays <strong>off</strong> until you enable it.
              </CardDescription>
            </CardHeader>
          </Card>

          {canWrite ? (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">Bind auth to tag</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">Tag</span>
                  <select
                    value={tagSlug}
                    onChange={(e) => setTagSlug(e.target.value)}
                    className="flex h-9 min-w-[8rem] rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {tags.length === 0 ? (
                      <option value={tagSlug}>{tagSlug || "nft"}</option>
                    ) : (
                      tags.map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.slug}
                        </option>
                      ))
                    )}
                    {!tags.some((t) => t.slug === "nft") ? (
                      <option value="nft">nft</option>
                    ) : null}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Auth account
                  </span>
                  <select
                    value={authId}
                    onChange={(e) => setAuthId(e.target.value)}
                    className="flex h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {authAccounts.length === 0 ? (
                      <option value="">No auth — add in Auth Pool</option>
                    ) : (
                      authAccounts.map((a) => (
                        <option key={a.id} value={a.id} disabled={!a.isActive}>
                          @{a.username}
                          {!a.isActive ? " (off)" : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Poll every
                  </span>
                  <select
                    value={intervalSec}
                    onChange={(e) => setIntervalSec(Number(e.target.value))}
                    className="flex h-9 min-w-[7rem] rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {POLL_INTERVAL_OPTIONS.map((o) => (
                      <option key={o.sec} value={o.sec}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Telegram topic (this tag)
                  </span>
                  <TopicPicker
                    value={createTopicId}
                    emptyLabel="Use signal map / default"
                    compact
                    showMeta={false}
                    onChange={(v) => setCreateTopicId(v)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoFollow}
                    onChange={(e) => setAutoFollow(e.target.checked)}
                  />
                  Auto-follow new {tagSlug || "tag"} projects
                </label>
                <Button type="button" disabled={busy || !authId} onClick={() => void saveScan()}>
                  <Plus className="size-3.5" />
                  Save binding
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void pollAll()}>
                  <Play className="size-3.5" />
                  Poll all
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Scanners</CardTitle>
              <CardDescription>
                {scans.length} tag binding{scans.length === 1 ? "" : "s"}. Each tag can use
                its own Telegram topic (nft → topic A, gamefi → topic B). Fallback:{" "}
                <strong>Telegram → Channel → Signal topic map</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {scans.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No scanners yet. Bind an auth account to a tag above.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {scans.map((s) => (
                    <li key={s.id} className="flex flex-col gap-3 px-4 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge>{s.tagSlug}</Badge>
                          <span className="text-sm">
                            → @{s.authUsername ?? s.authAccountId}
                          </span>
                          {s.enabled ? (
                            <Badge variant="success" className="text-[10px]">
                              on
                            </Badge>
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              off
                            </Badge>
                          )}
                          {s.autoFollow ? (
                            <Badge variant="secondary" className="text-[10px]">
                              auto-follow
                            </Badge>
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              manual follow
                            </Badge>
                          )}
                          <Badge variant="muted" className="text-[10px]">
                            every {formatInterval(s.intervalSec ?? 120)}
                          </Badge>
                          {s.topicId != null ? (
                            <Badge variant="secondary" className="text-[10px]">
                              topic #{s.topicId}
                            </Badge>
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              topic: map/default
                            </Badge>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            hits {s.hitCount}
                            {s.lastPolledAt ? ` · ${fmtDate(s.lastPolledAt)}` : " · never"}
                          </span>
                        </div>
                        {s.lastTweetId ? (
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            lastTweetId {s.lastTweetId}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[10px] text-amber-600">
                            No watermark yet — first poll seeds only
                          </p>
                        )}
                        {s.lastError ? (
                          <p className="text-xs text-destructive">{s.lastError}</p>
                        ) : null}
                      </div>
                      {canWrite ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <select
                            value={s.intervalSec ?? 120}
                            disabled={busy}
                            title="Poll interval"
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            onChange={(e) =>
                              void patchScan(
                                s.id,
                                { intervalSec: Number(e.target.value) },
                                `Poll every ${formatInterval(Number(e.target.value))}`,
                              )
                            }
                          >
                            {[
                              ...POLL_INTERVAL_OPTIONS,
                              // keep current value if custom
                              ...(!POLL_INTERVAL_OPTIONS.some(
                                (o) => o.sec === (s.intervalSec ?? 120),
                              )
                                ? [
                                    {
                                      sec: s.intervalSec ?? 120,
                                      label: formatInterval(s.intervalSec ?? 120),
                                    },
                                  ]
                                : []),
                            ].map((o) => (
                              <option key={o.sec} value={o.sec}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            disabled={busy}
                            onClick={() => void pollScan(s.id, s.tagSlug)}
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
                              void patchScan(
                                s.id,
                                { autoFollow: !s.autoFollow },
                                s.autoFollow ? "Auto-follow off" : "Auto-follow on",
                              )
                            }
                          >
                            {s.autoFollow ? "Disable auto" : "Enable auto"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            disabled={busy}
                            onClick={() =>
                              void patchScan(s.id, { resetWatermark: true }, "Watermark reset")
                            }
                          >
                            Reset WM
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            disabled={busy}
                            onClick={() =>
                              void patchScan(
                                s.id,
                                { enabled: !s.enabled },
                                s.enabled ? "Paused" : "Enabled",
                              )
                            }
                          >
                            {s.enabled ? "Pause" : "Resume"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 text-destructive"
                            disabled={busy}
                            onClick={() =>
                              setPendingDelete({
                                kind: "scan",
                                id: s.id,
                                label: s.tagSlug,
                              })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ) : null}
                      </div>

                      {canWrite ? (
                        <div className="flex max-w-md flex-col gap-1 sm:ml-0">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Telegram topic for <strong>{s.tagSlug}</strong> alerts
                          </span>
                          <TopicPicker
                            value={s.topicId != null ? String(s.topicId) : ""}
                            emptyLabel="Signal map / default topic"
                            compact
                            showMeta={false}
                            className="min-w-0"
                            onChange={(v) =>
                              void patchScan(
                                s.id,
                                {
                                  topicId: v === "" ? null : Number(v),
                                },
                                v
                                  ? `${s.tagSlug} → topic ${v}`
                                  : `${s.tagSlug} → map/default topic`,
                              )
                            }
                          />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "follows" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Projects by tag → follow</CardTitle>
                  <CardDescription>
                    Latest unfollowed projects ({PROJECT_PAGE_SIZE} per page). Follow
                    stays local — scroll to the end and use <strong>Load more</strong>,
                    or <strong>Refresh list</strong> to start over.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loadingProjects || !followTag}
                  onClick={() => void loadTagProjects(followTag, projectSearch)}
                >
                  {loadingProjects ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Refresh list
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">Tag</span>
                  <select
                    value={followTag}
                    onChange={(e) => onFollowTagChange(e.target.value)}
                    className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {scans.map((s) => (
                      <option key={`scan-${s.tagSlug}`} value={s.tagSlug}>
                        {s.tagSlug} · @{s.authUsername ?? "?"}
                      </option>
                    ))}
                    {tags
                      .filter((t) => !scans.some((s) => s.tagSlug === t.slug))
                      .map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.label ? `${t.slug} (${t.label})` : t.slug}
                        </option>
                      ))}
                    {scans.length === 0 && tags.length === 0 ? (
                      <option value={followTag}>{followTag}</option>
                    ) : null}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Auth (follows as)
                  </span>
                  <select
                    value={followAuthId}
                    onChange={(e) => setFollowAuthId(e.target.value)}
                    className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {authAccounts.length === 0 ? (
                      <option value="">No auth in pool</option>
                    ) : (
                      authAccounts.map((a) => (
                        <option key={a.id} value={a.id} disabled={!a.isActive}>
                          @{a.username}
                          {!a.isActive ? " (off)" : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    Search username
                  </span>
                  <div className="flex gap-1">
                    <Input
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder="optional filter…"
                      className="h-9 w-full sm:w-40"
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          void loadTagProjects(followTag, projectSearch);
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9"
                      disabled={loadingProjects}
                      onClick={() => void loadTagProjects(followTag, projectSearch)}
                    >
                      {loadingProjects ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{followTag}</Badge>
                <span>
                  showing {projectQueue.length}
                  {tagProjectsTotal > 0 ? ` · ${tagProjectsTotal} tagged total` : ""}
                </span>
                <span>·</span>
                <span>
                  {projectQueue.filter((p) => isFollowed(p)).length} followed in this
                  queue
                </span>
                <span>·</span>
                <span>
                  {follows.filter((f) => f.tagSlug === followTag).length} already
                  following total
                </span>
                {hasMoreProjects ? (
                  <>
                    <span>·</span>
                    <span className="text-foreground/80">more available</span>
                  </>
                ) : projectQueue.length > 0 ? (
                  <>
                    <span>·</span>
                    <span>end of list</span>
                  </>
                ) : null}
              </div>

              {loadingProjects ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Loading latest projects…
                </p>
              ) : projectQueue.length === 0 && !hasMoreProjects ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No unfollowed projects for <strong>{followTag}</strong>. Click{" "}
                  <strong>Refresh list</strong>, or follow a handle manually below.
                </p>
              ) : (
                <div className="max-h-[min(28rem,55vh)] overflow-y-auto rounded-lg border border-border">
                  {projectQueue.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      First page was already followed. Scroll down and{" "}
                      <strong>Load more</strong>.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {projectQueue.map((p) => {
                        const rowBusy = followingId === p.id;
                        const done = isFollowed(p);
                        return (
                          <li
                            key={p.id}
                            className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <a
                                  href={`https://x.com/${p.username}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium hover:underline"
                                >
                                  @{p.username}
                                </a>
                                {p.isBlueVerified ? (
                                  <span className="text-xs text-primary">✓</span>
                                ) : null}
                                {done ? (
                                  <Badge variant="success" className="text-[10px]">
                                    following
                                  </Badge>
                                ) : null}
                                <a
                                  href={`https://x.com/${p.username}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-muted-foreground"
                                >
                                  <ExternalLink className="size-3" />
                                </a>
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {p.name}
                                {p.followersCount != null
                                  ? ` · ${fmtNum(p.followersCount)} flw`
                                  : ""}
                                {` · seen ${fmtDate(p.firstSeenAt)}`}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-0.5">
                                {p.tags.slice(0, 4).map((t) => (
                                  <Badge
                                    key={t}
                                    variant={t === followTag ? "default" : "muted"}
                                    className="text-[10px]"
                                  >
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            {canWrite ? (
                              done ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 shrink-0"
                                  disabled
                                >
                                  Following
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 shrink-0"
                                  disabled={busy || !followAuthId || rowBusy}
                                  onClick={() =>
                                    void followProject({
                                      username: p.username,
                                      twitterUserId: p.id,
                                    })
                                  }
                                >
                                  {rowBusy ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <UserPlus className="size-3.5" />
                                  )}
                                  Follow
                                </Button>
                              )
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="sticky bottom-0 border-t border-border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                    {hasMoreProjects ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 w-full"
                        disabled={loadingMore || loadingProjects}
                        onClick={() => void loadMoreProjects()}
                      >
                        {loadingMore ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            Loading…
                          </>
                        ) : (
                          <>
                            <Plus className="size-3.5" />
                            Load more
                            {tagProjectsTotal > projectOffset
                              ? ` (${Math.max(0, tagProjectsTotal - projectOffset)} left in tag)`
                              : ""}
                          </>
                        )}
                      </Button>
                    ) : (
                      <p className="py-1 text-center text-xs text-muted-foreground">
                        All fetched projects shown
                        {tagProjectsTotal > 0 ? ` · ${tagProjectsTotal} tagged` : ""}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {canWrite ? (
                <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                  <span className="text-xs text-muted-foreground">Or by handle:</span>
                  <Input
                    value={followUser}
                    onChange={(e) => setFollowUser(e.target.value)}
                    placeholder="@not_in_list_yet"
                    className="h-9 w-full sm:w-48"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-9"
                    disabled={busy || !followAuthId || !followUser.trim()}
                    onClick={() => void manualFollow()}
                  >
                    <UserPlus className="size-3.5" />
                    Follow @{followUser.replace(/^@/, "") || "…"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <div>
                <CardTitle className="text-base">Already following</CardTitle>
                <CardDescription className="text-xs">
                  {follows.length} total
                  {followTag
                    ? ` · ${follows.filter((f) => f.tagSlug === followTag).length} for ${followTag}`
                    : ""}
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refreshFollows()}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {follows.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No followed projects yet. Pick a tag above and Follow.
                </p>
              ) : (
                <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                  {follows.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                    >
                      <div>
                        <a
                          href={`https://x.com/${f.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:underline"
                        >
                          @{f.username}
                        </a>
                        <span className="ml-2 text-xs text-muted-foreground">
                          via @{f.authUsername ?? "?"}
                          {f.tagSlug ? ` · ${f.tagSlug}` : ""} · {f.source ?? "manual"}
                          {f.createdAt ? ` · ${fmtDate(f.createdAt)}` : ""}
                        </span>
                      </div>
                      {canWrite ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={busy}
                          onClick={() =>
                            setPendingDelete({
                              kind: "follow",
                              id: f.id,
                              label: `@${f.username}`,
                            })
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "rules" ? (
        <SignalRulesPanel initialRules={rules} tags={tags} />
      ) : null}

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(o) => {
          if (!o && !busy) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.label}?`}
        description={
          pendingDelete?.kind === "follow"
            ? "Unfollow on Twitter and remove from catalog."
            : "This cannot be undone."
        }
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
