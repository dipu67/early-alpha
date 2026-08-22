import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { GrowthPanel } from "./growth-panel";
import type { GrowthBoardRow } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GrowthPageProps {
  searchParams: Promise<{ days?: string; top?: string }>;
}

export default async function GrowthPage({ searchParams }: GrowthPageProps) {
  const sp = await searchParams;
  const days = Math.min(30, Math.max(1, parseInt(sp.days ?? "7") || 7));
  const top = Math.min(50, Math.max(5, parseInt(sp.top ?? "20") || 20));

  const [growthRes] = await Promise.all([
    backendFetch("/api/growth/stats", {
      query: { days: String(days), top: String(top) },
    }),
  ]);

  const growth = growthRes.ok ? (growthRes.body as { items: GrowthBoardRow[]; days: number; top: number }) : { items: [], days, top };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Growth Monitor"
        description="Projects ranked by follower growth over selectable time windows. Send report to Telegram."
      />
      <GrowthPanel
        initialItems={growth.items}
        initialDays={growth.days}
        initialTop={growth.top}
      />
    </div>
  );
}
