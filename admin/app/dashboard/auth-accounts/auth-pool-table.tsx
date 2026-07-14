"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { fmtDate, type AuthAccount } from "@/lib/types";

export function AuthPoolTable({ initialItems }: { initialItems: AuthAccount[] }) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AuthAccount | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  async function deleteOne() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const res = await proxy(`/api/auth-accounts/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(`Deleted @${pendingDelete.username}`);
        setItems((prev) => prev.filter((a) => a.id !== pendingDelete.id));
        setPendingDelete(null);
        router.refresh();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? "Delete failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll() {
    setBusy(true);
    try {
      const res = await proxy("/api/auth-accounts", { method: "DELETE" });
      if (res.ok) {
        const body = res.body as { deleted?: number };
        toast.success(`Deleted ${body.deleted ?? items.length} auth account(s)`);
        setItems([]);
        setDeleteAllOpen(false);
        router.refresh();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? "Delete all failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {items.length} credential{items.length === 1 ? "" : "s"} in pool.
          {items.some((a) => a.isActive) ? null : (
            <span className="ml-1 text-destructive">No active accounts — scrapers will fail.</span>
          )}
        </p>
        {canWrite && items.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => setDeleteAllOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Delete all
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table className="min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <div>@{a.username}</div>
                  <div className="font-mono text-xs text-muted-foreground">{a.id}</div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {a.authToken}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {a.isActive ? (
                      <Badge variant="success">active</Badge>
                    ) : (
                      <Badge variant="muted">inactive</Badge>
                    )}
                    {a.rateLimited ? (
                      <Badge variant="destructive">rate-limited</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {fmtDate(a.lastUsedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {canWrite ? (
                      a.isActive ? (
                        <ActionButton
                          label="Deactivate"
                          method="PATCH"
                          size="sm"
                          path={`/api/auth-accounts/${a.id}`}
                          body={{ isActive: false }}
                          variant="ghost"
                        />
                      ) : (
                        <ActionButton
                          label="Activate"
                          method="PATCH"
                          size="sm"
                          path={`/api/auth-accounts/${a.id}`}
                          body={{ isActive: true }}
                          variant="secondary"
                        />
                      )
                    ) : null}
                    {canWrite ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => setPendingDelete(a)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(o) => {
          if (!o && !busy) setPendingDelete(null);
        }}
        title={`Delete @${pendingDelete?.username}?`}
        description="Removes this session from the pool. Pinned search queries / lists will lose this auth pin (set null)."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={() => void deleteOne()}
      />

      <ConfirmDialog
        open={deleteAllOpen}
        onOpenChange={(o) => {
          if (!o && !busy) setDeleteAllOpen(false);
        }}
        title="Delete ALL auth accounts?"
        description={`This removes all ${items.length} Twitter sessions. Scraping, monitors, and search stop until you add fresh cookies. Use when you get HTTP 401 / code 32.`}
        confirmLabel="Delete all"
        destructive
        loading={busy}
        onConfirm={() => void deleteAll()}
      />
    </div>
  );
}
