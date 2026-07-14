// Pro-hunter intelligence: hot board (convergence heat), entity fusion, hunt stages.

import { prisma } from "../db/prisma.js";

export const HUNT_STAGES = ["noise", "soft", "hot", "skip", "taken"] as const;
export type HuntStage = (typeof HUNT_STAGES)[number];

export function isHuntStage(x: string): x is HuntStage {
  return (HUNT_STAGES as readonly string[]).includes(x);
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600 * 1000);
}

function accountAgeDays(createdAt: Date | null | undefined): number | null {
  if (!createdAt) return null;
  return Math.floor((Date.now() - createdAt.getTime()) / (86400 * 1000));
}

/** Heat score: multi-source signal strength for ranking the hot board. */
function heatScore(input: {
  seedCount: number;
  watcherCount: number;
  searchHits: number;
  ageDays: number | null;
  followers: number | null;
  hoursSince: number;
}): number {
  let s = 0;
  s += input.seedCount * 25;
  s += input.watcherCount * 18;
  s += Math.min(input.searchHits, 5) * 8;
  // Freshness decay over 72h
  s += Math.max(0, 20 - input.hoursSince / 3.6);
  // Young accounts boost
  if (input.ageDays != null) {
    if (input.ageDays <= 14) s += 15;
    else if (input.ageDays <= 60) s += 8;
    else if (input.ageDays <= 180) s += 3;
  }
  // Prefer not mega-accounts for "early"
  if (input.followers != null) {
    if (input.followers < 500) s += 10;
    else if (input.followers < 5_000) s += 6;
    else if (input.followers < 50_000) s += 2;
    else if (input.followers > 500_000) s -= 15;
  }
  return Math.round(s * 10) / 10;
}

export type HotBoardItem = {
  accountId: string;
  username: string;
  name: string;
  tags: string[];
  followersCount: number | null;
  isBlueVerified: boolean | null;
  accountCreatedAt: string | null;
  accountAgeDays: number | null;
  firstSeenAt: string;
  huntStage: string;
  huntNote: string | null;
  heat: number;
  seedCount: number;
  seedUsernames: string[];
  watcherCount: number;
  watcherUsernames: string[];
  searchHits: number;
  lastSignalAt: string | null;
  sources: string[];
};

export async function getHotBoard(opts: {
  hours?: number;
  minHeat?: number | null;
  maxFollowers?: number | null;
  maxAgeDays?: number | null;
  tag?: string | null;
  stage?: string | null;
  limit?: number;
}): Promise<HotBoardItem[]> {
  const hours = opts.hours ?? 72;
  const since = hoursAgo(hours);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  // Parallel signal pulls
  const [edgeDetails, logs, convAlerts, hitGroups, newAccounts] =
    await Promise.all([
      prisma.followEdge.findMany({
        where: { active: true, firstSeenAt: { gte: since } },
        select: {
          followingId: true,
          firstSeenAt: true,
          seed: { select: { username: true } },
        },
      }),
      prisma.alertLog.findMany({
        where: { sentAt: { gte: since }, newFollowId: { not: "" } },
        select: {
          newFollowId: true,
          sentAt: true,
          watchList: { select: { username: true } },
        },
      }),
      prisma.alert.findMany({
        where: { alertType: "convergence", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.searchHit.groupBy({
        by: ["username"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        _max: { createdAt: true, authorId: true },
      }),
      // Brand-new projects first-seen in window (early radar even without multi-seed yet)
      prisma.twitterAccount.findMany({
        where: { firstSeenAt: { gte: since } },
        select: { id: true },
        take: 300,
        orderBy: { firstSeenAt: "desc" },
      }),
    ]);

  const idSet = new Set<string>();
  for (const e of edgeDetails) idSet.add(e.followingId);
  for (const l of logs) if (l.newFollowId) idSet.add(l.newFollowId);
  for (const a of convAlerts) idSet.add(a.followingId);
  for (const h of hitGroups) {
    if (h._max.authorId) idSet.add(h._max.authorId);
  }
  for (const a of newAccounts) idSet.add(a.id);

  if (idSet.size === 0) return [];

  const accounts = await prisma.twitterAccount.findMany({
    where: {
      id: { in: [...idSet] },
      ...(opts.tag ? { tags: { has: opts.tag } } : {}),
      ...(opts.stage ? { huntStage: opts.stage } : {}),
      ...(opts.maxFollowers != null
        ? {
            OR: [
              { followersCount: { lte: opts.maxFollowers } },
              { followersCount: null },
            ],
          }
        : {}),
    },
  });

  const seedsByTarget = new Map<string, { usernames: Set<string>; first: Date }>();
  for (const e of edgeDetails) {
    let bucket = seedsByTarget.get(e.followingId);
    if (!bucket) {
      bucket = { usernames: new Set(), first: e.firstSeenAt };
      seedsByTarget.set(e.followingId, bucket);
    }
    bucket.usernames.add(e.seed.username);
    if (e.firstSeenAt < bucket.first) bucket.first = e.firstSeenAt;
  }

  const watchersByTarget = new Map<string, { usernames: Set<string>; last: Date }>();
  for (const l of logs) {
    let bucket = watchersByTarget.get(l.newFollowId);
    if (!bucket) {
      bucket = { usernames: new Set(), last: l.sentAt };
      watchersByTarget.set(l.newFollowId, bucket);
    }
    bucket.usernames.add(l.watchList.username);
    if (l.sentAt > bucket.last) bucket.last = l.sentAt;
  }

  const hitsByUser = new Map(
    hitGroups.map((h) => [
      h.username.toLowerCase(),
      { count: h._count.id, last: h._max.createdAt as Date | null },
    ]),
  );

  const convById = new Map<string, (typeof convAlerts)[0]>();
  for (const a of convAlerts) {
    if (!convById.has(a.followingId)) convById.set(a.followingId, a);
  }

  const items: HotBoardItem[] = [];

  for (const acc of accounts) {
    const seeds = seedsByTarget.get(acc.id);
    const watchers = watchersByTarget.get(acc.id);
    const hits = hitsByUser.get(acc.username.toLowerCase());
    const conv = convById.get(acc.id);

    const seedCount = Math.max(seeds?.usernames.size ?? 0, conv?.seedCount ?? 0);
    const seedUsernames = [
      ...new Set([
        ...(seeds ? [...seeds.usernames] : []),
        ...(conv?.seedUsernames ?? []),
      ]),
    ];
    const watcherCount = watchers?.usernames.size ?? 0;
    const watcherUsernames = watchers ? [...watchers.usernames] : [];
    const searchHits = hits?.count ?? 0;
    const isNew = acc.firstSeenAt >= since;

    const ageDays = accountAgeDays(acc.createdAt);
    if (opts.maxAgeDays != null && ageDays != null && ageDays > opts.maxAgeDays) {
      continue;
    }

    // Need signal: multi-source OR new project OR any follow/search
    if (seedCount + watcherCount + searchHits === 0 && !isNew) continue;

    const lastEvent = [
      seeds?.first,
      watchers?.last,
      hits?.last ?? null,
      conv?.createdAt,
      isNew ? acc.firstSeenAt : null,
    ]
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const hoursSince = lastEvent
      ? (Date.now() - lastEvent.getTime()) / 3600_000
      : hours;

    const sources: string[] = [];
    if (seedCount >= 2) sources.push("seed-convergence");
    else if (seedCount === 1) sources.push("seed-follow");
    if (watcherCount >= 2) sources.push("watch-convergence");
    else if (watcherCount === 1) sources.push("watch-follow");
    if (searchHits > 0) sources.push("search");
    if (conv) sources.push("alert");
    if (isNew) sources.push("first-seen");

    const heat = heatScore({
      seedCount,
      watcherCount,
      searchHits: searchHits + (isNew ? 1 : 0),
      ageDays,
      followers: acc.followersCount,
      hoursSince,
    });

    if (opts.minHeat != null && heat < opts.minHeat) continue;

    items.push({
      accountId: acc.id,
      username: acc.username,
      name: acc.name,
      tags: acc.tags,
      followersCount: acc.followersCount,
      isBlueVerified: acc.isBlueVerified,
      accountCreatedAt: acc.createdAt?.toISOString() ?? null,
      accountAgeDays: ageDays,
      firstSeenAt: acc.firstSeenAt.toISOString(),
      huntStage: acc.huntStage,
      huntNote: acc.huntNote,
      heat,
      seedCount,
      seedUsernames,
      watcherCount,
      watcherUsernames,
      searchHits,
      lastSignalAt: lastEvent?.toISOString() ?? null,
      sources,
    });
  }

  items.sort((a, b) => b.heat - a.heat);
  return items.slice(0, limit);
}

export async function getEntity(accountId: string) {
  const account = await prisma.twitterAccount.findUnique({
    where: { id: accountId },
    include: {
      listMemberships: {
        include: { list: { select: { slug: true, name: true } } },
      },
      alerts: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
  if (!account) return null;

  const [seedEdges, alertLogs, searchHits, researchRuns] = await Promise.all([
    prisma.followEdge.findMany({
      where: { followingId: accountId, active: true },
      orderBy: { firstSeenAt: "desc" },
      take: 30,
      include: { seed: { select: { username: true, category: true, label: true } } },
    }),
    prisma.alertLog.findMany({
      where: { newFollowId: accountId },
      orderBy: { sentAt: "desc" },
      take: 30,
      include: { watchList: { select: { username: true } } },
    }),
    prisma.searchHit.findMany({
      where: {
        OR: [
          { authorId: accountId },
          { username: { equals: account.username, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { query: { select: { query: true, label: true } } },
    }),
    prisma.grokResearchRun.findMany({
      where: { projectIds: { has: accountId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        status: true,
        tag: true,
        createdAt: true,
        response: true,
      },
    }),
  ]);

  const ageDays = accountAgeDays(account.createdAt);

  return {
    account: {
      id: account.id,
      username: account.username,
      name: account.name,
      description: account.description,
      tags: account.tags,
      followersCount: account.followersCount,
      followingCount: account.followingCount,
      isBlueVerified: account.isBlueVerified,
      profileImageUrl: account.profileImageUrl,
      createdAt: account.createdAt,
      firstSeenAt: account.firstSeenAt,
      huntStage: account.huntStage,
      huntNote: account.huntNote,
      huntUpdatedAt: account.huntUpdatedAt,
      accountAgeDays: ageDays,
    },
    lists: account.listMemberships.map((m) => ({
      slug: m.list.slug,
      name: m.list.name,
      addedAt: m.addedAt,
    })),
    seedFollows: seedEdges.map((e) => ({
      seed: e.seed.username,
      category: e.seed.category,
      firstSeenAt: e.firstSeenAt,
      lastSeenAt: e.lastSeenAt,
    })),
    watchFollows: alertLogs.map((l) => ({
      watcher: l.watchList.username,
      sentAt: l.sentAt,
      analysis: l.analysis,
    })),
    convergenceAlerts: account.alerts.map((a) => ({
      type: a.alertType,
      score: a.score,
      seedCount: a.seedCount,
      seedUsernames: a.seedUsernames,
      reason: a.reason,
      createdAt: a.createdAt,
    })),
    searchHits: searchHits.map((h) => ({
      tweetId: h.tweetId,
      text: h.text,
      query: h.query.label || h.query.query,
      postedAt: h.postedAt,
      createdAt: h.createdAt,
    })),
    researchRuns: researchRuns.map((r) => ({
      id: r.id.toString(),
      title: r.title,
      status: r.status,
      tag: r.tag,
      createdAt: r.createdAt,
      excerpt: r.response ? r.response.slice(0, 400) : null,
    })),
  };
}

export async function setHuntStage(
  accountId: string,
  stage: HuntStage,
  note?: string | null,
) {
  const data: {
    huntStage: string;
    huntUpdatedAt: Date;
    huntNote?: string | null;
  } = {
    huntStage: stage,
    huntUpdatedAt: new Date(),
  };
  if (note !== undefined) data.huntNote = note;

  return prisma.twitterAccount.update({
    where: { id: accountId },
    data,
    select: {
      id: true,
      username: true,
      huntStage: true,
      huntNote: true,
      huntUpdatedAt: true,
    },
  });
}
