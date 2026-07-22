import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import {
  SignalRulesPanel,
  type SignalRuleItem,
} from "./signal-rules-panel";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const [rulesRes, tagsRes] = await Promise.all([
    backendFetch("/api/signals/rules"),
    backendFetch("/api/tags"),
  ]);

  const rules = (
    rulesRes.ok ? (rulesRes.body as { items: SignalRuleItem[] }).items : []
  ) as SignalRuleItem[];

  const tags = (
    tagsRes.ok
      ? (
          tagsRes.body as {
            items?: { slug: string; label?: string }[];
          }
        ).items ?? (tagsRes.body as { slug: string }[])
      : []
  ) as { slug: string; label?: string }[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Signals"
        description="Shared lifecycle rules (All tags) + per-tag extras. Early monitor multi-tags untagged projects and falls back on mint/WL structure so fewer posts are missed."
      />
      {!rulesRes.ok ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Backend error loading rules ({rulesRes.status}). Is the API running?
        </p>
      ) : null}
      <SignalRulesPanel
        initialRules={rules}
        tags={Array.isArray(tags) ? tags.map((t) => ({ slug: t.slug, label: t.label })) : []}
      />
    </div>
  );
}
