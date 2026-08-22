import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ProjectTableWithCheckboxes } from "./project-table-checkbox";
import {
  fmtNum,
  type Paged,
  type Project,
  type ProjectSort,
} from "@/lib/types";
import { ProjectsFilters } from "./projects-filters";
import { FetchMissingBiosButton } from "./fetch-bios-button";

export const dynamic = "force-dynamic";

const ALLOWED_SORT = new Set<ProjectSort>([
  "latest",
  "oldest",
  "followers",
  "followers_asc",
  "username",
  "updated",
]);

function parseSort(raw: string | undefined): ProjectSort {
  if (raw && ALLOWED_SORT.has(raw as ProjectSort)) return raw as ProjectSort;
  return "latest";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    sort?: string;
    missingBio?: string;
    category?: string;
    projectStatus?: string;
    chain?: string;
  }>;
}) {
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const search = sp.search ?? "";
  const missingBioOnly = sp.missingBio === "1" || sp.missingBio === "true";
  const categoryFilter = sp.category ?? "";
  const statusFilter = sp.projectStatus ?? "";
  const chainFilter = sp.chain ?? "";

  const [res, chainRes] = await Promise.all([
    backendFetch("/api/projects", {
      query: {
        search: search || undefined,
        sort,
        limit: "200",
        includeProject: "1",
        ...(missingBioOnly ? { missingBio: "1" } : {}),
        ...(categoryFilter ? { category: [categoryFilter] } : {}),
        ...(statusFilter ? { projectStatus: statusFilter } : {}),
        ...(chainFilter ? { chain: chainFilter } : {}),
      },
    }),
    backendFetch("/api/project-chains"),
  ]);

  const data = (res.ok ? res.body : { items: [], total: 0 }) as Paged<Project> & {
    sort?: string;
    missingBioCount?: number;
  };
  const chains = chainRes.ok ? (chainRes.body as { items: string[] }) : { items: [] };
  const missingBioCount = data.missingBioCount ?? 0;

  const enrichedCount = data.items.filter((p) => p.project != null).length;

  return (
    <div>
      <PageHeader
        title="Projects & Tags"
        description="Detected accounts and tags. Fetch missing bios via getUsersByIds, re-tag, or remove."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ProjectsFilters
          search={search}
          sort={sort}
          total={data.total}
          missingBioOnly={missingBioOnly}
          missingBioCount={missingBioCount}
          category={categoryFilter}
          status={statusFilter}
          chain={chainFilter}
          chains={chains.items}
        />
        <FetchMissingBiosButton missingBioCount={missingBioCount} />
        <span className="ml-auto text-xs text-muted-foreground">
          {enrichedCount}/{data.items.length} enriched
        </span>
      </div>

      {!res.ok ? (
        <p className="mb-3 text-sm text-destructive">
          Backend error {res.status}
          {typeof res.body === "object" && res.body && "error" in res.body
            ? `: ${String((res.body as { error?: string }).error)}`
            : ""}
          . Restart the API if sort was just added.
        </p>
      ) : null}

      {data.items.length === 0 ? (
        <EmptyState title="No projects match" description="Try a different category or search." />
      ) : (
        <ProjectTableWithCheckboxes items={data.items} />
      )}
    </div>
  );
}
