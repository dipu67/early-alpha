import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { type Scheduler } from "@/lib/types";
import { QueuesTable } from "./queues-table";

export const dynamic = "force-dynamic";

export default async function QueuesPage() {
  const res = await backendFetch("/api/queues");
  const data = (res.ok ? res.body : { items: [] }) as { items: Scheduler[] };

  return (
    <div>
      <PageHeader
        title="Queues"
        description="Recurring job schedulers. Pause, trigger, or edit interval/cron schedules — changes persist across restarts."
      />
      {!res.ok ? <p className="mb-3 text-sm text-destructive">Backend error {res.status}.</p> : null}
      <QueuesTable initial={data.items} />
    </div>
  );
}
