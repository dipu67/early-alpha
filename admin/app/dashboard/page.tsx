import { backendFetch } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { LineChartCard, BarChartCard, PieChartCard } from "@/components/charts";
import { fmtDate, fmtNum, type Overview, type TimePoint, type ActivityItem } from "@/lib/types";
import { Radio } from "lucide-react";

export const dynamic = "force-dynamic";

async function get<T>(path: string, fallback: T): Promise<T> {
  const res = await backendFetch(path);
  return (res.ok ? res.body : fallback) as T;
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

export default async function OverviewPage() {
  const [overview, signalsTs, followsTs, tagDist, activity] = await Promise.all([
    get<Overview>("/api/metrics/overview", {
      projects: 0, taggedProjects: 0, activeWatch: 0, lists: 0, listMembers: 0,
      signals24h: 0, authActive: 0, authRateLimited: 0,
    }),
    get<{ points: TimePoint[] }>("/api/metrics/timeseries?metric=signals&days=14", { points: [] }),
    get<{ points: TimePoint[] }>("/api/metrics/timeseries?metric=follows&days=14", { points: [] }),
    get<{ items: { tag: string; count: number }[] }>("/api/metrics/tag-distribution", { items: [] }),
    get<{ items: ActivityItem[] }>("/api/metrics/activity?limit=20", { items: [] }),
  ]);

  return (
    <div>
      <PageHeader title="Overview" description="Live health of the early-alpha tracking system." />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Projects" value={fmtNum(overview.projects)} hint={`${fmtNum(overview.taggedProjects)} tagged`} />
        <Kpi label="Signals (24h)" value={fmtNum(overview.signals24h)} />
        <Kpi label="Active watchlist" value={overview.activeWatch} />
        <Kpi label="Lists" value={overview.lists} hint={`${fmtNum(overview.listMembers)} members`} />
        <Kpi label="Auth active" value={overview.authActive} />
        <Kpi label="Rate-limited" value={overview.authRateLimited} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Signals / day (14d)</CardTitle></CardHeader>
          <CardContent><LineChartCard data={signalsTs.points} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>New follows / day (14d)</CardTitle></CardHeader>
          <CardContent><BarChartCard data={followsTs.points} /></CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Tag distribution</CardTitle></CardHeader>
          <CardContent>
            {tagDist.items.length === 0 ? (
              <EmptyState title="No tags yet" description="Tagged projects will appear here." />
            ) : (
              <PieChartCard data={tagDist.items.slice(0, 8)} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent className="max-h-64 overflow-y-auto">
            {activity.items.length === 0 ? (
              <EmptyState icon={Radio} title="No recent activity" />
            ) : (
              <ul className="space-y-2 text-sm">
                {activity.items.map((a) => (
                  <li
                    key={`${a.type}-${a.id}`}
                    className="flex flex-col gap-1 border-b border-border/40 pb-2 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:border-0 sm:pb-0"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant={a.type === "signal" ? "success" : "secondary"}>{a.type}</Badge>
                      <span className="truncate">@{a.username ?? "unknown"}</span>
                      {a.slug ? <span className="text-muted-foreground">· {a.slug}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
