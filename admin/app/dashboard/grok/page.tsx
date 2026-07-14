import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type { GrokConversationItem, Paged } from "@/lib/types";
import { GrokTabs } from "./grok-tabs";

export const dynamic = "force-dynamic";

export default async function GrokPage() {
  const res = await backendFetch("/api/grok/conversations", {
    query: { limit: "100" },
  });
  const data = (res.ok ? res.body : { items: [], total: 0 }) as Paged<GrokConversationItem>;

  return (
    <div>
      <PageHeader
        title="Grok"
        description="Telegram bot conversations, plus research: pick tagged projects (e.g. NFT), build a special prompt, run Grok, store results."
      />

      {!res.ok ? (
        <p className="mb-3 text-sm text-destructive">
          Backend error {res.status} loading conversations
          {typeof res.body === "object" && res.body && "error" in res.body
            ? `: ${String((res.body as { error?: string }).error)}`
            : ""}
          . Restart the API if routes were just added.
        </p>
      ) : null}

      <GrokTabs
        conversationItems={data.items}
        conversationTotal={data.total}
      />
    </div>
  );
}
