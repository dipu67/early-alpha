import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type { AuthAccount, ListMonitorHitItem, ListMonitorItem, Paged } from "@/lib/types";
import { ListMonitorManager } from "./list-monitor-manager";

export const dynamic = "force-dynamic";

export default async function ListMonitorsPage() {
  const [mRes, hRes, aRes] = await Promise.all([
    backendFetch("/api/list-monitors"),
    backendFetch("/api/list-monitors/hits", { query: { limit: "20" } }),
    backendFetch("/api/auth-accounts"),
  ]);

  const monitors = (mRes.ok ? mRes.body : { items: [] }) as { items: ListMonitorItem[] };
  const hits = (hRes.ok ? hRes.body : { items: [], total: 0 }) as Paged<ListMonitorHitItem>;
  const auths = (aRes.ok ? aRes.body : { items: [] }) as { items: AuthAccount[] };

  return (
    <div className="space-y-4">
      <PageHeader
        title="List Monitors"
        description="Watch any public Twitter list timeline → Telegram topic. Auth pin, poll interval, watermarked alerts."
      />

      {!mRes.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error {mRes.status}. Run migration for list_monitors if needed.
        </p>
      ) : null}

      <ListMonitorManager
        initialMonitors={monitors.items}
        initialHits={hits.items}
        authAccounts={auths.items}
      />
    </div>
  );
}
