import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import type { AuthAccount } from "@/lib/types";
import { AddAuthForm } from "./add-auth-form";
import { AuthPoolTable } from "./auth-pool-table";

export const dynamic = "force-dynamic";

export default async function AuthAccountsPage() {
  const res = await backendFetch("/api/auth-accounts");
  const data = (res.ok ? res.body : { items: [] }) as { items: AuthAccount[] };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Auth Pool"
        description="Paste auth_token + ct0 only. We validate with Twitter getCurrentUser, then store the real user id and @username. Dead sessions are soft-paused (rate-limited), not permanently deleted."
      />

      <AddAuthForm />

      {!res.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error {res.status}.
        </p>
      ) : null}

      {data.items.length === 0 ? (
        <EmptyState
          title="No auth accounts"
          description="Add auth_token and ct0 from a live X session. Username and id are filled automatically."
        />
      ) : (
        <AuthPoolTable initialItems={data.items} />
      )}
    </div>
  );
}
