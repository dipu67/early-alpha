import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type { HotBoardItem } from "@/lib/types";
import { HunterBoard } from "./hunter-board";

export const dynamic = "force-dynamic";

export default async function HunterPage() {
  const [hotRes, pipeRes] = await Promise.all([
    backendFetch("/api/hunter/hot", {
      query: { hours: "72", limit: "50" },
    }),
    backendFetch("/api/hunter/pipeline"),
  ]);

  const hot = (
    hotRes.ok
      ? hotRes.body
      : { items: [], total: 0, hours: 72, stages: [] }
  ) as {
    items: HotBoardItem[];
    total: number;
    hours: number;
    stages: string[];
  };

  const pipeline = (
    pipeRes.ok ? pipeRes.body : { counts: {} }
  ) as { counts: Record<string, number> };

  return (
    <div>
      <PageHeader
        title="Hunter"
        description="Pro desk: multi-source heat (seeds · watchers · search · first-seen), funnel stages, and fused entity evidence."
      />

      {!hotRes.ok ? (
        <p className="mb-3 text-sm text-destructive">
          Backend error {hotRes.status}. Restart API if hunter routes were just added.
        </p>
      ) : null}

      <HunterBoard
        initialItems={hot.items}
        initialHours={hot.hours}
        pipeline={pipeline.counts}
        stages={hot.stages?.length ? hot.stages : ["noise", "soft", "hot", "skip", "taken"]}
      />
    </div>
  );
}
