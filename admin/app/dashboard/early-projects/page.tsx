import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type {
  EarlyProjectRow,
  EarlyProjectStats,
  GrowthBoardRow,
  Paged,
} from "@/lib/types";
import { EarlyMonitorPanel } from "./early-monitor-panel";

export const dynamic = "force-dynamic";

export default async function EarlyProjectsPage() {
  const [statsRes, listRes, growthRes] = await Promise.all([
    backendFetch("/api/early-projects/stats"),
    backendFetch("/api/early-projects", { query: { limit: "100" } }),
    backendFetch("/api/early-projects/growth", {
      query: { days: "7", top: "15" },
    }),
  ]);

  const stats = (
    statsRes.ok
      ? statsRes.body
      : {
          poolSize: 0,
          dueNow: 0,
          polled24h: 0,
          renames7d: 0,
          snapshots7d: 0,
          hot: 0,
          soft: 0,
          lastPoll: null,
          lastGrowthReport: null,
          config: {
            staleMs: 55 * 60 * 1000,
            maxAgeMs: 365 * 86400 * 1000,
            maxAgeDays: 365,
            maxFollowers: 50_000,
            maxFollowing: 50_000,
            firstSeenDays: 90,
            includeSoftHot: true,
            strictEarlyOnly: true,
            batchSize: 100,
            maxBatches: 10,
            maxAccountsPerCycle: 1000,
            maxTimelines: 40,
            delayMs: 400,
            snapshotMinMs: 6 * 3600 * 1000,
            signalTopicId: null,
            rawTopicId: null,
            profileChangeTopicId: null,
            sendRawPosts: false,
            tweetReqBudget: 980,
            pollEveryLabel: "1h",
          },
        }
  ) as EarlyProjectStats;

  const list = (
    listRes.ok ? listRes.body : { items: [], total: 0, limit: 100, offset: 0 }
  ) as Paged<EarlyProjectRow>;

  const growth = (
    growthRes.ok ? growthRes.body : { items: [], days: 7, top: 15 }
  ) as { items: GrowthBoardRow[]; days: number; top: number };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Early Monitor"
        description="Early-only pool: detection rules (age/followers), usersByIds profiles, FxTwitter timelines (~1k/min), signal + optional raw Telegram topics."
      />
      {!statsRes.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error ({statsRes.status}). Is the API running? Apply migrations
          if early-project tables are missing.
        </p>
      ) : null}
      <EarlyMonitorPanel
        stats={stats}
        initialItems={list.items}
        total={list.total}
        growth={growth.items}
        growthDays={growth.days}
      />
    </div>
  );
}
