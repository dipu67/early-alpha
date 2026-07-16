import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type {
  ChainlistGithubStatus,
  ChainlistSourcesConfig,
  KnownChainItem,
} from "@/lib/types";
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
          sources: { rpcs: true, github: true },
          snapshot: {
            path: "data/chainlist-snapshot.json",
            exists: false,
            updatedAt: null,
            count: 0,
            source: null,
          },
          github: {
            snapshotPath: "data/chainlist-github-snapshot.json",
            snapshotExists: false,
            snapshotUpdatedAt: null,
            snapshotCount: 0,
            repo: "DefiLlama/chainlist",
            registryPath: "constants/additionalChainRegistry",
            lastCommitSha: null,
            lastCommitUrl: null,
            lastCommitMessage: null,
            lastCommitAt: null,
          },
        }
  ) as {
    items: KnownChainItem[];
    total: number;
    alerted: number;
    topicId?: number | null;
    sources?: ChainlistSourcesConfig;
    snapshot?: {
      path: string;
      exists: boolean;
      updatedAt: string | null;
      count: number;
      source: string | null;
    };
    github?: ChainlistGithubStatus;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Chains"
        description="Two independent detectors: chainlist.org/rpcs.json snapshot, and DefiLlama/chainlist GitHub additionalChainRegistry (new chain files from commits). Toggle each on/off anytime."
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
        initialGithub={body.github}
        initialSources={body.sources ?? { rpcs: true, github: true }}
      />
    </div>
  );
}
