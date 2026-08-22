"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Check, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";

/** Bulk fetch bios for projects with null/empty description via getUsersByIds. */
export function FetchMissingBiosButton({
  missingBioCount,
}: {
  missingBioCount: number;
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [busy, setBusy] = useState(false);
  const [reclassify, setReclassify] = useState(false);

  if (!canWrite || missingBioCount <= 0) return null;

  async function run() {
    setBusy(true);
    try {
      const res = await proxy("/api/projects/fetch-profiles", {
        method: "POST",
        body: {
          missingBioOnly: true,
          limit: 100,
          reclassify,
        },
      });
      if (res.ok) {
        const b = res.body as {
          requested?: number;
          updated?: number;
          missing?: number;
          errors?: string[];
        };
        toast.success(
          `Fetched ${b.updated ?? 0}/${b.requested ?? 0} profiles` +
            (b.missing ? ` · ${b.missing} not returned by Twitter` : ""),
        );
        if (b.errors?.length) {
          toast.error(b.errors[0] ?? "Some batches failed");
        }
        router.refresh();
      } else {
        const err = res.body as { error?: string } | null;
        toast.error(err?.error ?? `Error ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-9"
        disabled={busy}
        onClick={() => void run()}
        title="getUsersByIds for accounts with empty bio"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        Fetch missing bios ({missingBioCount})
      </Button>
      <Button
        type="button"
        size="icon"
        variant={reclassify ? "secondary" : "outline"}
        className="h-7 w-7 rounded-full flex items-center justify-center text-sm"
        onClick={() => setReclassify(!reclassify)}
        title={reclassify ? "Disable reclassify" : "Enable reclassify"}
      >
        {reclassify ? (
          <Check className="size-3.5 text-primary" />
        ) : (
          <XCircle className="size-3.5 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
