"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import type { AuthAccount } from "@/lib/types";

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateListForm({ authAccounts }: { authAccounts: AuthAccount[] }) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [authId, setAuthId] = useState(
    () => authAccounts.find((a) => a.isActive && !a.rateLimited)?.id ?? "",
  );
  const [busy, setBusy] = useState(false);

  if (!canWrite) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = slugify(slug);
    if (!s) {
      toast.error("Slug required");
      return;
    }
    if (!authId) {
      toast.error("Select a Twitter auth account (list owner)");
      return;
    }
    setBusy(true);
    const res = await proxy("/api/lists", {
      method: "POST",
      body: {
        slug: s,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        authAccountId: authId,
      },
    });
    setBusy(false);
    if (res.ok) {
      const item = (res.body as { item?: { twitterListId?: string } })?.item;
      toast.success(
        item?.twitterListId
          ? `List created · Twitter id ${item.twitterListId}`
          : "List created",
      );
      setSlug("");
      setName("");
      setDescription("");
      router.refresh();
    } else {
      const b = res.body as { error?: string } | null;
      const err = b?.error ?? `Error ${res.status}`;
      toast.error(
        err === "list_slug_exists"
          ? "Slug already exists"
          : err === "auth_account_not_found_or_inactive"
            ? "Auth account missing or inactive"
            : err,
      );
    }
  }

  const active = authAccounts.filter((a) => a.isActive);

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle className="text-base">Create list</CardTitle>
        <CardDescription>
          Creates a real Twitter list under the selected auth account (owner). The list worker will
          not create lists — only this action does. Keep that auth account active for member ops.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={submit}
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
        >
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Slug
            </label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onBlur={() => setSlug((s) => slugify(s))}
              placeholder="nft"
              className="font-mono text-xs"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Display name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="NFT (optional)"
            />
          </div>
          <div className="space-y-1 lg:col-span-1 sm:col-span-2">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Twitter auth (owner)
            </label>
            <select
              value={authId}
              onChange={(e) => setAuthId(e.target.value)}
              required
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="" disabled>
                Select account…
              </option>
              {active.map((a) => (
                <option key={a.id} value={a.id} disabled={a.rateLimited}>
                  @{a.username}
                  {a.rateLimited ? " · rate limited" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="flex items-end sm:col-span-2 lg:col-span-1">
            <Button type="submit" disabled={busy || !authId} className="w-full">
              <Plus className="size-3.5" />
              {busy ? "Creating…" : "Create on Twitter"}
            </Button>
          </div>
        </form>
        {active.length === 0 ? (
          <p className="mt-2 text-xs text-destructive">
            No active auth accounts — add one under Auth Pool first.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
