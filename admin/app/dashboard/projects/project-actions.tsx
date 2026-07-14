"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { ReclassifyControl } from "./reclassify-control";

/** Edit tags + fetch bio + remove project. */
export function ProjectActions({
  accountId,
  username,
  currentTags,
  missingBio = false,
}: {
  accountId: string;
  username: string;
  currentTags: string[];
  missingBio?: boolean;
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);

  if (!canWrite) return null;

  async function fetchProfile() {
    setFetching(true);
    try {
      const res = await proxy(
        `/api/projects/${encodeURIComponent(accountId)}/fetch-profile`,
        {
          method: "POST",
          body: { reclassify: true },
        },
      );
      if (res.ok) {
        const b = res.body as {
          item?: { description?: string | null; tags?: string[] };
        };
        const bio = b.item?.description?.trim();
        toast.success(
          bio
            ? `Updated @${username} bio (+ re-tagged)`
            : `Fetched @${username} — bio still empty on Twitter`,
        );
        router.refresh();
      } else {
        const err = res.body as { error?: string } | null;
        toast.error(err?.error ?? `Fetch failed (${res.status})`);
      }
    } finally {
      setFetching(false);
    }
  }

  async function remove() {
    setBusy(true);
    const res = await proxy(`/api/projects/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    });
    setBusy(false);
    setOpen(false);
    if (res.ok) {
      toast.success(`Removed @${username}`);
      router.refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <ReclassifyControl accountId={accountId} currentTags={currentTags} />
      <Button
        type="button"
        variant={missingBio ? "secondary" : "outline"}
        size="sm"
        className="h-8"
        disabled={fetching || busy}
        onClick={() => void fetchProfile()}
        title={
          missingBio
            ? "Bio is empty — fetch via getUsersByIds and update"
            : "Re-fetch profile/bio via getUsersByIds"
        }
      >
        {fetching ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        {missingBio ? "Fetch bio" : "Refresh"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 text-destructive hover:text-destructive"
        disabled={busy || fetching}
        onClick={() => setOpen(true)}
        title={`Remove @${username}`}
      >
        <Trash2 className="size-3.5" />
        Remove
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
        title="Remove project?"
        description={`Remove @${username} from the database?\n\nThis deletes the account row, list memberships, and related alerts. They may reappear later if seeds still follow them.`}
        confirmLabel="Remove project"
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </div>
  );
}
