import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type { Paged, SeedAccount, SeedStats } from "@/lib/types";
import { SeedsPanel } from "./seeds-panel";

export const dynamic = "force-dynamic";

export default async function SeedsPage() {
  const [listRes, statsRes, catRes] = await Promise.all([
    backendFetch("/api/seeds", { query: { limit: "200" } }),
    backendFetch("/api/seeds/stats"),
    backendFetch("/api/seeds/categories"),
  ]);

  const data = (
    listRes.ok ? listRes.body : { items: [], total: 0, limit: 200, offset: 0 }
  ) as Paged<SeedAccount>;

  const stats = (
    statsRes.ok
      ? statsRes.body
      : {
          total: 0,
          active: 0,
          inactive: 0,
          missingTwitterId: 0,
          edgesActive: 0,
          newEdges24h: 0,
          convergence24h: 0,
          lastRun: null,
        }
  ) as SeedStats;

  const categories = (
    catRes.ok
      ? (catRes.body as { suggested?: string[]; inUse?: string[] })
      : { suggested: [], inUse: [] }
  ) as { suggested: string[]; inUse: string[] };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Seeds"
        description="Canonical smart-follow graph. Poll active seeds’ following lists; multi-seed convergence powers Hunter and digests. Prefer this over Watchlist (legacy)."
      />
      {!listRes.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error ({listRes.status}). Is the API running?
        </p>
      ) : null}
      <SeedsPanel
        initialItems={data.items}
        total={data.total}
        stats={stats}
        suggestedCategories={categories.suggested ?? []}
        inUseCategories={categories.inUse ?? []}
      />
    </div>
  );
}
