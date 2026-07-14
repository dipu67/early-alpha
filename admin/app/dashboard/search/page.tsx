import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type { AuthAccount, SearchHitItem, SearchQueryItem, Paged } from "@/lib/types";
import { SearchManager } from "./search-manager";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const [qRes, hRes, aRes] = await Promise.all([
    backendFetch("/api/search-queries"),
    backendFetch("/api/search-queries/hits", { query: { limit: "20" } }),
    backendFetch("/api/auth-accounts"),
  ]);

  const queries = (qRes.ok ? qRes.body : { items: [] }) as { items: SearchQueryItem[] };
  const hits = (hRes.ok ? hRes.body : { items: [], total: 0 }) as Paged<SearchHitItem>;
  const auths = (aRes.ok ? aRes.body : { items: [] }) as { items: AuthAccount[] };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Live Search"
        description="Realtime alerts only: poll Latest → Telegram on new posts. Keeps latest 20 hits per query (not full history)."
      />

      {!qRes.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error {qRes.status}. Restart API after migration if needed.
        </p>
      ) : null}

      <SearchManager
        initialQueries={queries.items}
        initialHits={hits.items}
        authAccounts={auths.items}
      />
    </div>
  );
}
