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
import { fmtDate, type Paged, type WatchEntry } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { AddWatchForm } from "./add-watch-form";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const res = await backendFetch("/api/watchlist", { query: { limit: "200" } });
  const data = (res.ok ? res.body : { items: [], total: 0 }) as Paged<WatchEntry>;

  return (
    <div>
      <PageHeader
        title="Watchlist"
        description="Accounts whose new follows are tracked. Add by username only — profile is fetched from Twitter. Track-now runs an immediate check."
      />

      <AddWatchForm />

      {!res.ok ? <p className="mb-3 text-sm text-destructive">Backend error {res.status}.</p> : null}

      {data.items.length === 0 ? (
        <EmptyState title="No watched accounts yet" description="Add one above to start tracking." />
      ) : (
        <div className="rounded-lg border border-border bg-card max-w-full">
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Alerts</TableHead>
                <TableHead>Last snapshot</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <a
                      href={`https://x.com/${w.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      @{w.username}
                    </a>
                    <div className="font-mono text-xs text-muted-foreground">{w.twitterUserId}</div>
                  </TableCell>
                  <TableCell>
                    {w.isActive ? <Badge variant="success">active</Badge> : <Badge variant="muted">inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{w.alertCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {fmtDate(w.lastSnapshotAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {w.isActive ? (
                        <>
                          <ActionButton
                            label="Track now"
                            pendingLabel="Enqueuing…"
                            size="sm"
                            path={`/api/watchlist/${w.id}/track-now`}
                          />
                          <ActionButton
                            label="Deactivate"
                            pendingLabel="Pausing…"
                            method="POST"
                            size="sm"
                            path={`/api/watchlist/${w.id}/deactivate`}
                            variant="outline"
                            confirmTitle={`Deactivate @${w.username}?`}
                            confirm={`Pause tracking for @${w.username}.\n\nThe entry stays in the list (history kept). Use Track now later to resume.`}
                          />
                        </>
                      ) : (
                        <ActionButton
                          label="Reactivate"
                          pendingLabel="Starting…"
                          size="sm"
                          path={`/api/watchlist/${w.id}/track-now`}
                          confirmTitle={`Reactivate @${w.username}?`}
                          confirm={`Resume tracking @${w.username} (registers the 5-min schedule and runs one check now).`}
                        />
                      )}
                      <ActionButton
                        label="Remove"
                        pendingLabel="Removing…"
                        method="DELETE"
                        size="sm"
                        path={`/api/watchlist/${w.id}`}
                        variant="destructive"
                        confirmTitle={`Remove @${w.username}?`}
                        confirm={`Permanently delete @${w.username} from the watchlist.\n\nFollow snapshots and alert history for this watch are removed. You can add them again later by username.`}
                      />
                    </div>
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
