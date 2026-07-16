import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type {
  GithubRepoCommitItem,
  GithubRepoMonitorItem,
  Paged,
} from "@/lib/types";
import { GithubRepoManager } from "./github-repo-manager";

export const dynamic = "force-dynamic";

export default async function GithubReposPage() {
  const [mRes, cRes] = await Promise.all([
    backendFetch("/api/github-repos"),
    backendFetch("/api/github-repos/commits", { query: { limit: "30" } }),
  ]);

  const monitors = (
    mRes.ok ? mRes.body : { items: [] }
  ) as { items: GithubRepoMonitorItem[] };
  const commits = (
    cRes.ok ? cRes.body : { items: [], total: 0 }
  ) as Paged<GithubRepoCommitItem>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="GitHub Repos"
        description="Watch public GitHub repos for new commits → Telegram. Path filter optional (e.g. chainlist additionalChainRegistry). First poll seeds watermark only."
      />

      {!mRes.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error {mRes.status}. Run migration for github_repo_monitors if
          needed.
        </p>
      ) : null}

      <GithubRepoManager
        initialMonitors={monitors.items}
        initialCommits={commits.items}
      />
    </div>
  );
}
