import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { ProjectTableWithCheckboxes } from "../projects/project-table-checkbox";
import { type Paged, type Project, type ProjectSort } from "@/lib/types";
import { ProjectsFilters } from "../projects/projects-filters";
import { WatchingControls } from "./watching-controls";
import { TopicSelectors } from "./topic-selectors";

export const dynamic = "force-dynamic";

const ALLOWED_SORT = new Set<ProjectSort>(["latest", "oldest", "followers", "followers_asc", "username", "updated"]);

function parseSort(raw: string | undefined): ProjectSort {
  if (raw && ALLOWED_SORT.has(raw as ProjectSort)) return raw as ProjectSort;
  return "latest";
}

interface SchedulerItem {
  key: string;
  label: string;
  paused: boolean;
  cron: string | null;
  every: number | null;
  nextRun: string | null;
}

interface WatchingConfig {
  signalEnabled: boolean;
  rowEnabled: boolean;
  intervalMs: number;
  signalTopicId: number | null;
  rowTopicId: number | null;
}

interface TopicOption {
  id: number;
  label: string;
  isGeneral: boolean;
}

export default async function WatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; sort?: string; chain?: string }>;
}) {
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const search = sp.search ?? "";
  const chainFilter = sp.chain ?? "";

  const [res, chainRes, schedRes, cfgRes, topicsRes] = await Promise.all([
    backendFetch("/api/projects", {
      query: {
        search: search || undefined,
        sort,
        limit: "200",
        includeProject: "1",
        projectStatus: "watching",
        ...(chainFilter ? { chain: chainFilter } : {}),
      },
    }),
    backendFetch("/api/project-chains"),
    backendFetch("/api/queues"),
    backendFetch("/api/watching/config"),
    backendFetch("/api/watching/topics"),
  ]);

  const data = (res.ok ? res.body : { items: [], total: 0 }) as Paged<Project>;
  const chains = chainRes.ok ? (chainRes.body as { items: string[] }) : { items: [] };
  const schedData = schedRes.ok ? (schedRes.body as { items: SchedulerItem[] }) : { items: [] };
  const cfg = cfgRes.ok ? (cfgRes.body as WatchingConfig) : null;
  const topicsData = topicsRes.ok ? (topicsRes.body as { topics: TopicOption[] }) : { topics: [] };

  const watchingScheduler = schedData.items.find((s) => s.key === "watching-poll");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Watching Monitor"
        description="Projects under active surveillance. Configure polling interval, alerts, and queue settings."
      />

      {/* Control Panel */}
      <WatchingControls
        scheduler={watchingScheduler}
        config={cfg}
      />

      {/* Topic Selectors */}
      <TopicSelectors
        signalTopicId={cfg?.signalTopicId ?? null}
        rowTopicId={cfg?.rowTopicId ?? null}
        topics={topicsData.topics}
      />

      {/* Filter Bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ProjectsFilters
          search={search}
          sort={sort}
          total={data.total}
          status="watching"
          chain={chainFilter}
          chains={chains.items}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {data.items.length}/{data.total} watching
        </span>
      </div>

      {/* Projects Table */}
      {!res.ok ? (
        <p className="mb-3 text-sm text-destructive">Backend error {res.status}</p>
      ) : data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <EmptyState
            title="No watching projects"
            description="Go to Projects → set status to 'watching' to monitor here."
          />
          <a
            href="/dashboard/projects?projectStatus=watching"
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            View Projects with status filter
          </a>
        </div>
      ) : (
        <ProjectTableWithCheckboxes items={data.items} />
      )}
    </div>
  );
}
