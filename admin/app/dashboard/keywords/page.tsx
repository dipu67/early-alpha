import { backendFetch } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProjectTag } from "@/lib/types";
import { KeywordsManager } from "./keywords-manager";

export const dynamic = "force-dynamic";

export default async function KeywordsPage() {
  const [tagsRes, tagStatsRes] = await Promise.all([
    backendFetch("/api/tags"),
    backendFetch("/api/tag-stats"),
  ]);

  const data = (tagsRes.ok ? tagsRes.body : { items: [] }) as { items: ProjectTag[] };
  const tagStats = tagStatsRes.ok ? (tagStatsRes.body as { categories: { tag: string; count: number }[]; chains: { chain: string; count: number }[]; enabledTags: number; totalTags: number; chainTags: number; regularTags: number }) : null;

  return (
    <div>
      {tagStats ? (
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Tag breakdown */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Tag Types</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Regular tags</span>
                <Badge variant="secondary">{tagStats.regularTags}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Chain tags</span>
                <Badge className="bg-violet-600">{tagStats.chainTags}</Badge>
              </div>
              <div className="flex items-center justify-between pt-1 border-t">
                <span className="text-xs font-medium">Total</span>
                <span className="text-lg font-bold">{tagStats.totalTags}</span>
              </div>
            </CardContent>
          </Card>

          {/* Category counts */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Project Categories</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1">
                {tagStats.categories.slice(0, 5).map((c) => (
                  <div key={`${c.tag}-${c.count}`} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{c.tag}</span>
                    <Badge variant="secondary">{c.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick links */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Quick Actions</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              <a href="/dashboard/projects?category=DeFi" className="text-xs text-primary hover:underline">View DeFi projects ({tagStats.categories.find(c => c.tag === 'DeFi')?.count ?? 0})</a>
              <a href="/dashboard/projects?category=NFT" className="text-xs text-primary hover:underline">View NFT projects ({tagStats.categories.find(c => c.tag === 'NFT')?.count ?? 0})</a>
              <a href="/dashboard/projects?chain=robinhood" className="text-xs text-primary hover:underline">View robinhood chain ({tagStats.chains.find(c => c.chain === 'robinhood')?.count ?? 0})</a>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {!tagsRes.ok ? (
        <p className="mb-3 text-sm text-destructive">Backend error {tagsRes.status}.</p>
      ) : null}

      <KeywordsManager initialTags={data.items} tagStats={tagStats ?? undefined} />
    </div>
  );
}

