import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import { type AuthAccount } from "@/lib/types";
import { LiveListsManager } from "./live-lists-manager";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const authRes = await backendFetch("/api/auth-accounts");
  const auths = (authRes.ok ? authRes.body : { items: [] }) as {
    items: AuthAccount[];
  };

  return (
    <div>
      <PageHeader
        title="Lists"
        description="Manage Twitter lists live via TwitterClient: create, members (dialog), add/remove, delete. Data from getMyLists / getListMembers — not the project DB."
      />

      {!authRes.ok ? (
        <p className="mb-3 text-sm text-destructive">
          Could not load auth accounts ({authRes.status}).
        </p>
      ) : null}

      <LiveListsManager authAccounts={auths.items} />
    </div>
  );
}
