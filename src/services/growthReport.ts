// Weekly top-growing early projects report.
// Compares current followers vs snapshot ~7d ago (or followersAtDetect).

import { prisma } from "../db/prisma.js";
import { formatGrowthReport } from "./formatAlert.js";
import { sendTelegramTopic, isAlertEnabled } from "../tg/sendAlert.js";

const WINDOW_DAYS = Math.max(1, Number(process.env.GROWTH_REPORT_DAYS ?? 7));
const TOP_N = Math.max(5, Math.min(50, Number(process.env.GROWTH_REPORT_TOP ?? 20)));
const MIN_ABS_GAIN = Math.max(0, Number(process.env.GROWTH_REPORT_MIN_GAIN ?? 100));
const MIN_PCT = Math.max(0, Number(process.env.GROWTH_REPORT_MIN_PCT ?? 20));

export type GrowthRow = {
  accountId: string;
  username: string;
  name: string;
  tags: string[];
  followersNow: number;
  followersBefore: number;
  absGain: number;
  pctGain: number;
  firstSeenAt: Date;
  huntStage: string;
};

/**
 * Rank early projects by follower growth over the window.
 * Baseline = oldest snapshot in [now-window, now] or followersAtDetect / first snapshot.
 */
export async function computeTopGrowingProjects(opts?: {
  days?: number;
  top?: number;
  minAbsGain?: number;
  minPct?: number;
}): Promise<GrowthRow[]> {
  const days = opts?.days ?? WINDOW_DAYS;
  const top = opts?.top ?? TOP_N;
  const minAbs = opts?.minAbsGain ?? MIN_ABS_GAIN;
  const minPct = opts?.minPct ?? MIN_PCT;
  const since = new Date(Date.now() - days * 86400 * 1000);

  // Active early-ish accounts with known follower counts
  const accounts = await prisma.twitterAccount.findMany({
    where: {
      followersCount: { not: null, gt: 0 },
      OR: [
        { firstSeenAt: { gte: new Date(Date.now() - 180 * 86400 * 1000) } },
        { huntStage: { in: ["soft", "hot"] } },
      ],
    },
    select: {
      id: true,
      username: true,
      name: true,
      tags: true,
      followersCount: true,
      followersAtDetect: true,
      firstSeenAt: true,
      huntStage: true,
    },
    take: 5000,
    orderBy: { firstSeenAt: "desc" },
  });

  if (accounts.length === 0) return [];

  const ids = accounts.map((a) => a.id);

  // Snapshots near the start of the window (closest at or before `since`, else earliest after)
  const snaps = await prisma.accountMetricSnapshot.findMany({
    where: {
      accountId: { in: ids },
      followersCount: { not: null },
      recordedAt: {
        gte: new Date(since.getTime() - 2 * 86400 * 1000),
        lte: new Date(),
      },
    },
    select: {
      accountId: true,
      followersCount: true,
      recordedAt: true,
    },
    orderBy: { recordedAt: "asc" },
  });

  /** Best baseline per account: snapshot closest to `since` from either side, prefer <= since */
  const baseline = new Map<string, number>();
  for (const s of snaps) {
    if (s.followersCount == null) continue;
    const existing = baseline.get(s.accountId);
    // First pass: take earliest in window as rough baseline; refine below
    if (existing == null) {
      baseline.set(s.accountId, s.followersCount);
    }
  }

  // Prefer snapshot at or before `since` with max recordedAt
  const before = new Map<string, { at: number; followers: number }>();
  for (const s of snaps) {
    if (s.followersCount == null) continue;
    if (s.recordedAt.getTime() <= since.getTime()) {
      const cur = before.get(s.accountId);
      if (!cur || s.recordedAt.getTime() > cur.at) {
        before.set(s.accountId, {
          at: s.recordedAt.getTime(),
          followers: s.followersCount,
        });
      }
    }
  }
  for (const [id, v] of before) {
    baseline.set(id, v.followers);
  }

  const rows: GrowthRow[] = [];
  for (const a of accounts) {
    const now = a.followersCount ?? 0;
    if (now <= 0) continue;

    let beforeN =
      baseline.get(a.id) ??
      a.followersAtDetect ??
      null;

    // If account younger than window, use detect baseline
    if (a.firstSeenAt.getTime() > since.getTime()) {
      beforeN = a.followersAtDetect ?? beforeN ?? now;
    }
    if (beforeN == null || beforeN <= 0) continue;

    const absGain = now - beforeN;
    const pctGain = (absGain / beforeN) * 100;
    if (absGain < minAbs && pctGain < minPct) continue;
    if (absGain <= 0) continue;

    rows.push({
      accountId: a.id,
      username: a.username,
      name: a.name,
      tags: a.tags,
      followersNow: now,
      followersBefore: beforeN,
      absGain,
      pctGain,
      firstSeenAt: a.firstSeenAt,
      huntStage: a.huntStage,
    });
  }

  // Rank: blend absolute growth + percentage (early small accounts can win on %)
  rows.sort((a, b) => {
    const scoreA = a.absGain + a.pctGain * 5;
    const scoreB = b.absGain + b.pctGain * 5;
    return scoreB - scoreA;
  });

  return rows.slice(0, top);
}

export async function sendWeeklyGrowthReport(): Promise<{
  sent: boolean;
  count: number;
}> {
  if (!(await isAlertEnabled("growthReport"))) {
    console.log("[growth-report] disabled via config");
    return { sent: false, count: 0 };
  }

  const rows = await computeTopGrowingProjects();
  if (rows.length === 0) {
    console.log("[growth-report] no growers above thresholds");
    return { sent: false, count: 0 };
  }

  const text = formatGrowthReport({
    days: WINDOW_DAYS,
    rows: rows.map((r) => ({
      username: r.username,
      name: r.name,
      tags: r.tags,
      followersNow: r.followersNow,
      followersBefore: r.followersBefore,
      absGain: r.absGain,
      pctGain: r.pctGain,
      huntStage: r.huntStage,
    })),
  });

  await sendTelegramTopic(text, undefined, "MarkdownV2", "growthReport");
  console.log(`[growth-report] sent top ${rows.length} growers (${WINDOW_DAYS}d)`);
  return { sent: true, count: rows.length };
}
