import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { type AuthAccount, type ProjectList } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { CreateListForm } from "./create-list-form";
import { ListsTable } from "./lists-table";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const [res, authRes] = await Promise.all([
    backendFetch("/api/lists"),
    backendFetch("/api/auth-accounts"),
  ]);
  const data = (res.ok ? res.body : { items: [] }) as { items: ProjectList[] };
  const auths = (authRes.ok ? authRes.body : { items: [] }) as { items: AuthAccount[] };

  return (
    <div>
      <PageHeader
        title="Lists"
        description="Create lists here with a chosen auth owner. The list worker only fills members — it never auto-creates lists."
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton
              label="Reconcile now"
              pendingLabel="Enqueuing…"
              path="/api/reconcile"
              variant="default"
            />
            <ActionButton
              label="Delete all lists"
              path="/api/lists/delete"
              body={{ all: false }}
              variant="destructive"
              confirm="Enqueue deletion of all project lists? They will be rebuilt on next reconcile."
            />
          </div>
        }
      />

      {!res.ok ? (
        <p className="mb-3 text-sm text-destructive">Backend error {res.status}.</p>
      ) : null}

      <CreateListForm authAccounts={auths.items} />

      {data.items.length === 0 ? (
        <EmptyState
          title="No lists yet"
          description="Create one above, or run reconcile to create lists for tag slugs."
        />
      ) : (
        <ListsTable lists={data.items} />
      )}
    </div>
  );
}
