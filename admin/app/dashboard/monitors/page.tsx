import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type { ProjectMonitorItem } from "@/lib/types";
import { MonitorsPanel } from "./monitors-panel";

export const dynamic = "force-dynamic";

export default async function MonitorsPage() {
  const res = await backendFetch("/api/monitors");
  const items = (
    res.ok ? (res.body as { items: ProjectMonitorItem[] }).items : []
  ) as ProjectMonitorItem[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="User Monitor"
        description="Starts empty. Only @usernames you add are monitored. No auto-enroll."
      />
      {!res.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error ({res.status}). Is the API running?
        </p>
      ) : null}
      <MonitorsPanel initialItems={items} />
    </div>
  );
}
