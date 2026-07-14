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
  fmtDate,
  fmtNum,
  type Paged,
  type Project,
  type ProjectSort,
} from "@/lib/types";
import { ProjectActions } from "./project-actions";
import { ProjectsFilters } from "./projects-filters";

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
  searchParams: Promise<{ tag?: string; search?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const tag = sp.tag ?? "";
  const search = sp.search ?? "";

  const res = await backendFetch("/api/projects", {
    query: {
      tag: tag || undefined,
      search: search || undefined,
      sort,
      limit: "200",
    },
  });
  const data = (res.ok ? res.body : { items: [], total: 0 }) as Paged<Project> & {
    sort?: string;
  };

  return (
    <div>
      <PageHeader
        title="Projects & Tags"
        description="Detected accounts and their project-type tags. Edit tags or remove a project from the system. Change sort — it applies immediately."
      />

      <ProjectsFilters tag={tag} search={search} sort={sort} total={data.total} />

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
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[10rem]">Account</TableHead>
                <TableHead className="min-w-[8rem]">Tags</TableHead>
                <TableHead className="text-right">Followers</TableHead>
                <TableHead className="whitespace-nowrap">
                  {sort === "updated" ? "Updated" : "Seen"}
                </TableHead>
                <TableHead className="w-[8rem]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((p) => (
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
                    <div className="max-w-[14rem] truncate text-xs text-muted-foreground">
                      {p.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[18rem] flex-wrap gap-1">
                      {p.tags.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        p.tags.map((t) => (
                          <Badge key={t} variant={t === "unknown" ? "muted" : "default"}>
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
                    {fmtDate(
                      sort === "updated" ? (p.updatedAt ?? p.firstSeenAt) : p.firstSeenAt,
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <ProjectActions
                      accountId={p.id}
                      username={p.username}
                      currentTags={p.tags}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
