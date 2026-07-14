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
        description="Twitter session cookies (auth_token + ct0). On code 32 (dead session) the account is soft-paused (rate-limited), not permanently deactivated. Re-add fresh cookies if Activate keeps failing — old tokens will error again on the next poll."
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
          description="Add a live session: twitter user id, username, auth_token, ct0."
        />
      ) : (
        <AuthPoolTable initialItems={data.items} />
      )}
    </div>
  );
}
