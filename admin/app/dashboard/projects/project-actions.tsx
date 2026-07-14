"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { ReclassifyControl } from "./reclassify-control";

/** Edit tags + remove project from the system. */
export function ProjectActions({
  accountId,
  username,
  currentTags,
}: {
  accountId: string;
  username: string;
  currentTags: string[];
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canWrite) return null;

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
        variant="ghost"
        size="sm"
        className="h-8 text-destructive hover:text-destructive"
        disabled={busy}
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
