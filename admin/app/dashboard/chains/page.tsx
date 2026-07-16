import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type { KnownChainItem } from "@/lib/types";
import { ChainsPanel } from "./chains-panel";

export const dynamic = "force-dynamic";

export default async function ChainsPage() {
  const res = await backendFetch("/api/chainlist", {
    query: { limit: "50", includeTestnet: "false" },
  });
  const body = (
    res.ok
      ? res.body
      : {
          items: [],
          total: 0,
          alerted: 0,
          topicId: null,
          snapshot: {
            path: "data/chainlist-snapshot.json",
            exists: false,
            updatedAt: null,
            count: 0,
            source: null,
          },
        }
  ) as {
    items: KnownChainItem[];
    total: number;
    alerted: number;
    topicId?: number | null;
    snapshot?: {
      path: string;
      exists: boolean;
      updatedAt: string | null;
      count: number;
      source: string | null;
    };
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Chains"
        description="Fetch chainlist.org/rpcs.json → save JSON snapshot → next poll compares file → Telegram on new chainId (pick topic below)."
      />

      {!res.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error {res.status}.
        </p>
      ) : null}

      <ChainsPanel
        initialItems={body.items}
        initialTotal={body.total}
        initialAlerted={body.alerted}
        initialTopicId={body.topicId ?? null}
        initialSnapshot={body.snapshot}
      />
    </div>
  );
}
