import { backendFetch } from "@/lib/api";
import { PageHeader } from "@/components/ui/card";
import {
  type AuthAccount,
  type Paged,
  type SignalPost,
} from "@/lib/types";
import { SignalsDesk } from "./signals-desk";

export const dynamic = "force-dynamic";

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string; since?: string }>;
}) {
  const sp = await searchParams;
  const [signalsRes, scansRes, rulesRes, followsRes, authRes, tagsRes] =
    await Promise.all([
      backendFetch("/api/signals", {
        query: {
          slug: sp.slug,
          // Empty since = show stored feed (latest 20 per tag), not time-window only
          since: sp.since && sp.since !== "all" ? sp.since : undefined,
          limit: sp.slug ? "20" : "200",
          perTag: sp.slug ? "0" : "1",
        },
      }),
      backendFetch("/api/signals/scans"),
      backendFetch("/api/signals/rules"),
      backendFetch("/api/signals/auth-follows"),
      backendFetch("/api/auth-accounts"),
      backendFetch("/api/tags"),
    ]);

  const feed = (
    signalsRes.ok ? signalsRes.body : { items: [], total: 0 }
  ) as Paged<SignalPost>;

  const scans = (
    scansRes.ok ? (scansRes.body as { items: unknown[] }).items : []
  ) as Parameters<typeof SignalsDesk>[0]["scans"];

  const rules = (
    rulesRes.ok ? (rulesRes.body as { items: unknown[] }).items : []
  ) as Parameters<typeof SignalsDesk>[0]["rules"];

  const followsRaw =
    followsRes.ok && Array.isArray((followsRes.body as { items?: unknown })?.items)
      ? ((followsRes.body as { items: unknown[] }).items ?? [])
      : [];
  // Only keep real auth-follow rows (legacy AlertLog shape lacks username)
  const follows = followsRaw.filter(
    (f): f is Parameters<typeof SignalsDesk>[0]["follows"][number] =>
      !!f &&
      typeof f === "object" &&
      typeof (f as { username?: unknown }).username === "string" &&
      typeof (f as { id?: unknown }).id === "string",
  );

  const authAccounts = (
    authRes.ok ? (authRes.body as { items: AuthAccount[] }).items : []
  ) as AuthAccount[];

  const tags = (
    tagsRes.ok
      ? (
          tagsRes.body as {
            items?: { slug: string; label?: string }[];
          }
        ).items ??
        (tagsRes.body as { slug: string }[])
      : []
  ) as { slug: string; label?: string }[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Signals"
        description="Feed: latest 20 posts per tag. Promote to Monitor or Hunter. Flow: follow → HomeLatest → rules → Telegram."
      />
      <SignalsDesk
        feed={feed.items}
        feedSlug={sp.slug ?? ""}
        feedSince={sp.since ?? "all"}
        scans={scans}
        rules={rules}
        follows={follows}
        authAccounts={authAccounts}
        tags={Array.isArray(tags) ? tags.map((t) => ({ slug: t.slug, label: t.label })) : []}
      />
    </div>
  );
}
