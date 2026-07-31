import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  fmtNum,
  type Paged,
  type Project,
  type ProjectSort,
} from "@/lib/types";
import { LocalTime } from "@/components/local-time";
import { ProjectActions } from "./project-actions";
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

function isMissingBio(description: string | null | undefined): boolean {
  return description == null || description.trim() === "";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tag?: string;
    search?: string;
    sort?: string;
    missingBio?: string;
  }>;
}) {
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const tag = sp.tag ?? "";
  const search = sp.search ?? "";
  const missingBioOnly =
    sp.missingBio === "1" || sp.missingBio === "true";

  const res = await backendFetch("/api/projects", {
    query: {
      tag: tag || undefined,
      search: search || undefined,
      sort,
      limit: "200",
      ...(missingBioOnly ? { missingBio: "1" } : {}),
    },
  });
  const data = (res.ok ? res.body : { items: [], total: 0 }) as Paged<Project> & {
    sort?: string;
    missingBioCount?: number;
  };
  const missingBioCount = data.missingBioCount ?? 0;

  return (
    <div>
      <PageHeader
        title="Projects & Tags"
        description="Detected accounts and tags. Fetch missing bios via getUsersByIds, re-tag, or remove."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ProjectsFilters
          tag={tag}
          search={search}
          sort={sort}
          total={data.total}
          missingBioOnly={missingBioOnly}
          missingBioCount={missingBioCount}
        />
        <FetchMissingBiosButton missingBioCount={missingBioCount} />
        <form action="/api/proxy/api/early-projects/remove-old?minAgeMonths=6" method="POST" className="inline-block ml-auto">
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-md border border-destructive bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20">
            🗑 Remove Old (&gt;6mo)
          </button>
        </form>
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
        <EmptyState title="No projects match" description="Try a different tag or search." />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[12rem]">Account / bio</TableHead>
                <TableHead className="min-w-[8rem]">Tags</TableHead>
                <TableHead className="text-right">Followers</TableHead>
                <TableHead className="whitespace-nowrap">
                  {sort === "updated" ? "Updated" : "Seen"}
                </TableHead>
                <TableHead className="w-[12rem]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((p) => {
                const noBio = isMissingBio(p.description);
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <a
                        href={`https://x.com/${p.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        @{p.username}
                      </a>
                      {p.isBlueVerified ? (
                        <span className="ml-1 text-primary" title="Verified">
                          ✓
                        </span>
                      ) : null}
                      {noBio ? (
                        <Badge variant="muted" className="ml-1.5 text-[10px]">
                          no bio
                        </Badge>
                      ) : null}
                      <div className="max-w-[18rem] truncate text-xs text-muted-foreground">
                        {p.name}
                      </div>
                      <div className="mt-0.5 max-w-[20rem] truncate text-[11px] text-muted-foreground">
                        {noBio ? (
                          <span className="italic opacity-70">Bio not fetched</span>
                        ) : (
                          p.description
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[18rem] flex-wrap gap-1">
                        {p.tags.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          p.tags.map((t) => (
                            <Badge
                              key={t}
                              variant={t === "unknown" ? "muted" : "default"}
                            >
                              {t}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtNum(p.followersCount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      <LocalTime
                        iso={
                          sort === "updated"
                            ? (p.updatedAt ?? p.firstSeenAt)
                            : p.firstSeenAt
                        }
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <ProjectActions
                        accountId={p.id}
                        username={p.username}
                        currentTags={p.tags}
                        missingBio={noBio}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
