import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import type { ProjectTag } from "@/lib/types";
import { KeywordsManager } from "./keywords-manager";

export const dynamic = "force-dynamic";

export default async function KeywordsPage() {
  const res = await backendFetch("/api/tags");
  const data = (res.ok ? res.body : { items: [] }) as { items: ProjectTag[] };

  return (
    <div>
      <PageHeader
        title="Keywords"
        description="Manage bio keywords, regexes, and handle tokens used by the classifier. Edits apply within ~30s. Use Tools to seed the built-in lexicon or backfill account tags (same as CLI)."
      />

      {!res.ok ? (
        <p className="mb-3 text-sm text-destructive">Backend error {res.status}.</p>
      ) : null}

      <KeywordsManager initialTags={data.items} />
    </div>
  );
}
