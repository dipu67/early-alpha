"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";

/**
 * A button that fires a proxied backend request, toasts the result, and refreshes
 * server data on success. Optional `confirm` opens an app dialog (not window.confirm).
 */
export function ActionButton({
  label,
  pendingLabel,
  method = "POST",
  path,
  body,
  variant = "secondary",
  size,
  confirm,
  confirmTitle,
  onDone,
}: {
  label: string;
  pendingLabel?: string;
  method?: string;
  path: string;
  body?: unknown;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** If set, show ConfirmDialog before running. */
  confirm?: string;
  confirmTitle?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await proxy(path, { method, body });
      if (res.ok) {
        toast.success("Done");
        setOpen(false);
        startTransition(() => router.refresh());
        onDone?.();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? `Error ${res.status}`);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending;
  const needsConfirm = Boolean(confirm);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => {
          if (needsConfirm) setOpen(true);
          else void run();
        }}
      >
        {disabled ? (pendingLabel ?? "Working…") : label}
      </Button>
      {needsConfirm ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={confirmTitle ?? "Confirm action"}
          description={confirm!}
          confirmLabel={label}
          destructive={variant === "destructive"}
          loading={busy || isPending}
          onConfirm={run}
        />
      ) : null}
    </>
  );
}
