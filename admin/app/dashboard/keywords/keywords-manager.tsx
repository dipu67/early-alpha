"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Power, X, Database, RefreshCw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ProjectTag } from "@/lib/types";

type ToolConfirm =
  | null
  | { kind: "seed" }
  | { kind: "backfill"; onlyUnknown: boolean }
  | { kind: "backfill-chain" };

type TokenKind = "plain" | "regex" | "handle" | "suffix";

/** Well-known chain keywords that appear in tag labels. */
const KNOWN_CHAIN_KEYWORDS = [
  "ethereum", "eth", "solana", "sol", "arbitrum", "arb",
  "optimism", "op", "base", "zksync", "polygon", "matic",
  "bsc", "bnb", "avalanche", "avax", "near", "sui", "aptos",
  "cosmos", "ibc", "blast", "mode", "mantle", "linea", "scroll",
  "robinhood", "rcoin",
  "arc", "arcdao",
];

function isChainSlug(slug: string): boolean {
  return KNOWN_CHAIN_KEYWORDS.some((kw) => slug.toLowerCase().includes(kw));
}

function isChainLabel(label: string): boolean {
  return KNOWN_CHAIN_KEYWORDS.some((kw) => label.toLowerCase().includes(kw));
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function TokenChips({
  items,
  canWrite,
  busy,
  variant,
  format,
  onRemove,
}: {
  items: string[];
  canWrite: boolean;
  busy: boolean;
  variant: "plain" | "regex" | "handle" | "suffix";
  format?: (k: string) => string;
  onRemove: (value: string) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">None yet.</p>;
  }
  const chipClass =
    variant === "regex"
      ? "border-primary/30 bg-primary/10 text-primary"
      : variant === "handle"
        ? "border-success/30 bg-success/10 text-success"
        : variant === "suffix"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-border bg-muted/40";

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((k) => (
        <span
          key={k}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs ${chipClass}`}
        >
          {format ? format(k) : k}
          {canWrite ? (
            <button
              type="button"
              className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
              aria-label={`Remove ${k}`}
              disabled={busy}
              onClick={() => onRemove(k)}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function KeywordsManager({ initialTags, tagStats }: { initialTags: ProjectTag[]; tagStats?: { categories: { tag: string; count: number }[]; chains: { chain: string; count: number }[]; enabledTags: number; totalTags: number } }) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [tags, setTags] = useState(initialTags);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(initialTags[0]?.slug ?? null);
  const [busy, setBusy] = useState(false);

  // Keep local list in sync when the server re-renders with fresh data.
  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  const [newSlug, setNewSlug] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const [kwInput, setKwInput] = useState("");
  const [kwKind, setKwKind] = useState<TokenKind>("plain");

  const [labelDraft, setLabelDraft] = useState(initialTags[0]?.label ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toolConfirm, setToolConfirm] = useState<ToolConfirm>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const [newIsChain, setNewIsChain] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter(
      (t) =>
        t.slug.includes(q) ||
        t.label.toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q)) ||
        t.regexKeywords.some((k) => k.toLowerCase().includes(q)) ||
        (t.handleTokens ?? []).some((k) => k.toLowerCase().includes(q)) ||
        (t.handleSuffixTokens ?? []).some((k) => k.toLowerCase().includes(q)),
    );
  }, [tags, filter]);

  const active = tags.find((t) => t.slug === selected) ?? null;
  const handleTokens = active?.handleTokens ?? [];
  const handleSuffixTokens = active?.handleSuffixTokens ?? [];

  async function refresh() {
    const res = await proxy("/api/tags");
    if (res.ok) {
      const body = res.body as { items: ProjectTag[] };
      setTags(body.items);
      if (selected && !body.items.some((t) => t.slug === selected)) {
        setSelected(body.items[0]?.slug ?? null);
      }
    }
    router.refresh();
  }

  function selectTag(slug: string) {
    setSelected(slug);
    const t = tags.find((x) => x.slug === slug);
    setLabelDraft(t?.label ?? "");
    setKwInput("");
  }

  async function createTag(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    const slug = slugify(newSlug);
    const label = newLabel.trim() || slug;
    if (!slug) {
      toast.error("Slug required");
      return;
    }
    setBusy(true);
    const res = await proxy("/api/tags", {
      method: "POST",
      body: {
        slug,
        label,
        isChain: newIsChain,
        keywords: [],
        regexKeywords: [],
        handleTokens: [],
        handleSuffixTokens: [],
      },
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Created ${slug}${newIsChain ? " (chain)" : ""}`);
      setNewSlug("");
      setNewLabel("");
      setNewIsChain(false);
      await refresh();
      selectTag(slug);
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error === "tag_exists" ? "Tag already exists" : (b?.error ?? `Error ${res.status}`));
    }
  }

  async function patchTag(slug: string, body: Record<string, unknown>, okMsg: string) {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy(`/api/tags/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(okMsg);
      await refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function saveLabel() {
    if (!active || !labelDraft.trim()) return;
    await patchTag(active.slug, { label: labelDraft.trim() }, "Label updated");
  }

  async function toggleEnabled() {
    if (!active) return;
    await patchTag(
      active.slug,
      { enabled: !active.enabled },
      active.enabled ? "Tag disabled" : "Tag enabled",
    );
  }

  async function addToken(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !canWrite) return;
    const value = kwInput.trim();
    if (!value) return;

    if (kwKind === "regex") {
      try {
        // eslint-disable-next-line no-new
        new RegExp(value, "i");
      } catch {
        toast.error("Invalid regex");
        return;
      }
      if (active.regexKeywords.includes(value)) {
        toast.error("Already added");
        return;
      }
      await patchTag(
        active.slug,
        { regexKeywords: [...active.regexKeywords, value] },
        "Regex keyword added",
      );
    } else if (kwKind === "handle") {
      const v = value.toLowerCase();
      if (handleTokens.includes(v)) {
        toast.error("Already added");
        return;
      }
      await patchTag(active.slug, { handleTokens: [...handleTokens, v] }, "Handle token added");
    } else if (kwKind === "suffix") {
      const v = value.toLowerCase();
      if (handleSuffixTokens.includes(v)) {
        toast.error("Already added");
        return;
      }
      await patchTag(
        active.slug,
        { handleSuffixTokens: [...handleSuffixTokens, v] },
        "Suffix token added",
      );
    } else {
      if (active.keywords.includes(value)) {
        toast.error("Already added");
        return;
      }
      await patchTag(active.slug, { keywords: [...active.keywords, value] }, "Keyword added");
    }
    setKwInput("");
  }

  async function removeToken(kind: TokenKind, value: string) {
    if (!active || !canWrite) return;
    if (kind === "plain") {
      await patchTag(
        active.slug,
        { keywords: active.keywords.filter((k) => k !== value) },
        "Keyword removed",
      );
    } else if (kind === "regex") {
      await patchTag(
        active.slug,
        { regexKeywords: active.regexKeywords.filter((k) => k !== value) },
        "Regex keyword removed",
      );
    } else if (kind === "handle") {
      await patchTag(
        active.slug,
        { handleTokens: handleTokens.filter((k) => k !== value) },
        "Handle token removed",
      );
    } else {
      await patchTag(
        active.slug,
        { handleSuffixTokens: handleSuffixTokens.filter((k) => k !== value) },
        "Suffix token removed",
      );
    }
  }

  async function deleteTag() {
    if (!active || !canWrite) return;
    setBusy(true);
    const res = await proxy(`/api/tags/${encodeURIComponent(active.slug)}`, {
      method: "DELETE",
    });
    setBusy(false);
    setConfirmDelete(false);
    if (res.ok) {
      toast.success("Tag deleted");
      setSelected(null);
      await refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function runTool() {
    if (!toolConfirm || !canWrite) return;
    setToolBusy(true);
    try {
      if (toolConfirm.kind === "seed") {
        const res = await proxy("/api/tags/seed", { method: "POST", body: {} });
        if (res.ok) {
          toast.success("Seed keywords enqueued — list-worker will load the built-in lexicon");
          setToolConfirm(null);
          // Lexicon write is async; refresh shortly so new tags appear.
          setTimeout(() => void refresh(), 1500);
          await refresh();
        } else {
          const b = res.body as { error?: string } | null;
          toast.error(b?.error ?? `Error ${res.status}`);
        }
      } else if (toolConfirm.kind === "backfill-chain") {
        const res = await proxy("/api/projects/backfill-chain", {
          method: "POST",
          body: { limit: 2000 },
        });
        if (res.ok) {
          const b = res.body as { updated: number; scanned: number };
          toast.success(`Chain backfill done: ${b.updated} updated, ${b.scanned} scanned`);
          setToolConfirm(null);
          router.refresh();
        } else {
          const b = res.body as { error?: string } | null;
          toast.error(b?.error ?? `Error ${res.status}`);
        }
      } else {
        const res = await proxy("/api/tags/backfill", {
          method: "POST",
          body: { onlyUnknown: toolConfirm.onlyUnknown },
        });
        if (res.ok) {
          toast.success(
            toolConfirm.onlyUnknown
              ? "Backfill enqueued (unknown accounts only) — see list-worker logs"
              : "Backfill enqueued (all accounts) — see list-worker logs",
          );
          setToolConfirm(null);
        } else {
          const b = res.body as { error?: string } | null;
          toast.error(b?.error ?? `Error ${res.status}`);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setToolBusy(false);
    }
  }

  const placeholders: Record<TokenKind, string> = {
    plain: "keyword e.g. launchpad",
    regex: "regex e.g. \\bl1\\b",
    handle: "handle token e.g. defi",
    suffix: "suffix e.g. nft",
  };

  return (
    <div className="space-y-4">
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
            <CardDescription>
              Same as CLI: seed the built-in lexicon into the DB, then re-classify accounts. Jobs run
              on the list-worker queue.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="secondary"
              disabled={toolBusy}
              onClick={() => setToolConfirm({ kind: "seed" })}
              className="w-full sm:w-auto"
            >
              <Database className="mr-1.5 h-3.5 w-3.5" />
              Seed keywords
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={toolBusy}
              onClick={() => setToolConfirm({ kind: "backfill", onlyUnknown: true })}
              className="w-full sm:w-auto"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Backfill unknown
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={toolBusy}
              onClick={() => setToolConfirm({ kind: "backfill", onlyUnknown: false })}
              className="w-full sm:w-auto"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Backfill all accounts
            </Button>
            {tagStats ? (
              <Button
                type="button"
                variant="outline"
                disabled={toolBusy}
                onClick={() => setToolConfirm({ kind: "backfill-chain" })}
                className="w-full sm:w-auto"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Backfill chains ({tagStats.chains.reduce((a, b) => a + b.count, 0)})
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription>{tags.length} tags in lexicon</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tags or tokens…"
          />

          {canWrite ? (
            <form
              onSubmit={createTag}
              className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
            >
              <div className="min-w-[7rem] flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Slug</label>
                <Input
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="my-tag"
                  className="font-mono text-xs"
                />
              </div>
              <div className="min-w-[7rem] flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Label</label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="My Tag"
                />
              </div>
              <div className="min-w-[7rem] flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Type</label>
                <select
                  value={newIsChain ? "chain" : "tag"}
                  onChange={(e) => setNewIsChain(e.target.value === "chain")}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="tag">Tag</option>
                  <option value="chain">Chain</option>
                </select>
              </div>
              <Button type="submit" size="sm" disabled={busy}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </form>
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState
              title="No tags"
              description="Create a tag or use Seed keywords above."
            />
          ) : (
            <div className="max-h-[28rem] overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tag</TableHead>
                    <TableHead className="text-right">KW</TableHead>
                    <TableHead className="text-right">H</TableHead>
                    <TableHead className="text-right">Chain</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow
                      key={t.slug}
                      className={
                        t.slug === selected
                          ? "cursor-pointer bg-muted/50"
                          : "cursor-pointer hover:bg-muted/30"
                      }
                      onClick={() => {
                        selectTag(t.slug);
                        setLabelDraft(t.label);
                      }}
                    >
                      <TableCell>
                        <div className="font-medium">{t.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{t.slug}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {!t.enabled ? <Badge variant="muted">off</Badge> : null}
                          {t.isBuiltin ? <Badge variant="secondary">builtin</Badge> : null}
                          {t.isChain ? (
                            <Badge variant="default" className="bg-violet-600">chain</Badge>
                          ) : isChainLabel(t.label) ? (
                            <Badge variant="default" className="bg-violet-600">chain*</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {t.keywordCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {t.handleTokenCount ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {t.isChain || isChainSlug(t.slug) || isChainLabel(t.label) ? "✓" : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>{active ? active.label : "Select a tag"}</CardTitle>
          <CardDescription>
            {active
              ? `${active.slug} · ${active.keywordCount} bio keywords · ${active.handleTokenCount ?? 0} handle tokens`
              : "Pick a tag on the left to edit matchers."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!active ? (
            <EmptyState title="Nothing selected" description="Choose a tag to manage matchers." />
          ) : (
            <div className="space-y-5">
              {canWrite ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[10rem] flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground">Display label</label>
                    <Input
                      value={labelDraft}
                      onChange={(e) => setLabelDraft(e.target.value)}
                      onFocus={() => {
                        if (!labelDraft) setLabelDraft(active.label);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Chain tag</label>
                    <select
                      value={active.isChain ? "chain" : "tag"}
                      onChange={async (e) => {
                        const isChain = e.target.value === "chain";
                        await patchTag(active.slug, { isChain }, "Chain status updated");
                        await refresh();
                      }}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="tag">Tag</option>
                      <option value="chain">Chain</option>
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || labelDraft.trim() === active.label}
                    onClick={saveLabel}
                  >
                    Save label
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={toggleEnabled}>
                    <Power className="mr-1 h-3.5 w-3.5" />
                    {active.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Viewer mode — sign in as editor or admin to edit.
                </p>
              )}

              {canWrite ? (
                <form onSubmit={addToken} className="flex flex-wrap items-center gap-2">
                  <Input
                    value={kwInput}
                    onChange={(e) => setKwInput(e.target.value)}
                    placeholder={placeholders[kwKind]}
                    className="min-w-[12rem] flex-1 font-mono text-xs"
                  />
                  <select
                    value={kwKind}
                    onChange={(e) => setKwKind(e.target.value as TokenKind)}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="plain">Bio keyword</option>
                    <option value="regex">Bio regex</option>
                    <option value="handle">Handle token</option>
                    <option value="suffix">Handle suffix</option>
                  </select>
                  <Button type="submit" disabled={busy || !kwInput.trim()}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add
                  </Button>
                </form>
              ) : null}

              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  Bio keywords{" "}
                  <span className="font-normal text-muted-foreground">
                    ({active.keywords.length}) — whole-word in name/description
                  </span>
                </h3>
                <TokenChips
                  items={active.keywords}
                  canWrite={canWrite}
                  busy={busy}
                  variant="plain"
                  onRemove={(v) => removeToken("plain", v)}
                />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  Bio regex{" "}
                  <span className="font-normal text-muted-foreground">
                    ({active.regexKeywords.length}) — /i on name/description
                  </span>
                </h3>
                <TokenChips
                  items={active.regexKeywords}
                  canWrite={canWrite}
                  busy={busy}
                  variant="regex"
                  format={(k) => `/${k}/i`}
                  onRemove={(v) => removeToken("regex", v)}
                />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  Handle tokens{" "}
                  <span className="font-normal text-muted-foreground">
                    ({handleTokens.length}) — match in @handle as delim token (e.g. foo_defi_bar)
                  </span>
                </h3>
                <TokenChips
                  items={handleTokens}
                  canWrite={canWrite}
                  busy={busy}
                  variant="handle"
                  onRemove={(v) => removeToken("handle", v)}
                />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  Handle suffixes{" "}
                  <span className="font-normal text-muted-foreground">
                    ({handleSuffixTokens.length}) — @handle ends with token (e.g. coolnft)
                  </span>
                </h3>
                <TokenChips
                  items={handleSuffixTokens}
                  canWrite={canWrite}
                  busy={busy}
                  variant="suffix"
                  onRemove={(v) => removeToken("suffix", v)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!busy) setConfirmDelete(open);
        }}
        title="Delete tag?"
        description={
          active
            ? `Delete tag "${active.slug}"?\n\nThis removes its keywords and handle tokens from the classifier. Accounts already tagged keep their tags until reclassified.`
            : ""
        }
        confirmLabel="Delete tag"
        destructive
        loading={busy}
        onConfirm={deleteTag}
      />

      <ConfirmDialog
        open={toolConfirm !== null}
        onOpenChange={(open) => {
          if (!toolBusy && !open) setToolConfirm(null);
        }}
        title={
          toolConfirm?.kind === "seed"
            ? "Seed keywords from lexicon?"
            : toolConfirm?.kind === "backfill-chain"
              ? "Backfill project chains?"
              : toolConfirm?.onlyUnknown
                ? "Backfill unknown accounts?"
                : "Backfill all accounts?"
        }
        description={
          toolConfirm?.kind === "seed"
            ? "Upsert built-in tags, bio keywords, regexes, and handle tokens from the lexicon file into the database.\n\nExisting custom tags you added in the UI are kept; matching builtin slugs are overwritten with the file contents."
            : toolConfirm?.kind === "backfill-chain"
              ? "Re-derive chain (and category) for all existing Projects using current bio+handle keywords.\n\nScans up to 2000 projects — fast and non-destructive (only updates changed fields)."
              : toolConfirm?.onlyUnknown
                ? "Re-classify accounts that are untagged or only tagged \"unknown\".\n\nRuns on list-worker — can take a while on large DBs. List membership may update for changed tags."
                : "Re-classify every twitter account with the current DB lexicon.\n\nThis can overwrite manual tag edits and take a long time. Prefer \"Backfill unknown\" when you only care about new/untyped accounts."
        }
        confirmLabel={
          toolConfirm?.kind === "seed"
            ? "Seed keywords"
            : toolConfirm?.kind === "backfill-chain"
              ? "Backfill chains"
              : toolConfirm?.onlyUnknown
                ? "Backfill unknown"
                : "Backfill all"
        }
        destructive={toolConfirm?.kind === "backfill" && !toolConfirm.onlyUnknown}
        loading={toolBusy}
        onConfirm={runTool}
      />
    </div>
  );
}
