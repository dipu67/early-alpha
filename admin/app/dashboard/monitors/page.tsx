import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type {
  ProjectMonitorItem,
  ProjectMonitorTagRule,
  ProjectTag,
} from "@/lib/types";
import { MonitorsPanel } from "./monitors-panel";

export const dynamic = "force-dynamic";

export default async function MonitorsPage() {
  const [monRes, rulesRes, tagsRes] = await Promise.all([
    backendFetch("/api/monitors"),
    backendFetch("/api/monitors/tag-rules"),
    backendFetch("/api/tags"),
  ]);

  const items = (
    monRes.ok ? (monRes.body as { items: ProjectMonitorItem[] }).items : []
  ) as ProjectMonitorItem[];

  const rules = (
    rulesRes.ok
      ? (rulesRes.body as { items: ProjectMonitorTagRule[] }).items
      : []
  ) as ProjectMonitorTagRule[];

  // Tags endpoint may return { items } or array depending on route
  let tags: ProjectTag[] = [];
  if (tagsRes.ok && tagsRes.body) {
    const b = tagsRes.body as { items?: ProjectTag[] } | ProjectTag[];
    tags = Array.isArray(b) ? b : (b.items ?? []);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="User Monitor"
        description="Tag-based bulk enroll + efficient tweetCount prefilter (usersByIds → getUserTweets only when count increases). Username renames tracked by rest id."
      />
      {!monRes.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error ({monRes.status}). Is the API running? Run migrations if
          monitor tag rules are missing.
        </p>
      ) : null}
      <MonitorsPanel initialItems={items} initialRules={rules} tags={tags} />
    </div>
  );
}
