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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { fmtDate, type ProjectList } from "@/lib/types";

export function ListsTable({ lists }: { lists: ProjectList[] }) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  async function del(slug: string) {
    if (!canWrite) return;
    setBusySlug(slug);
    const res = await proxy(`/api/lists/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
    setBusySlug(null);
    setPendingSlug(null);
    if (res.ok) {
      const b = res.body as { twitterDeleted?: boolean } | null;
      toast.success(
        b?.twitterDeleted === false
          ? `Removed "${slug}" from DB (already gone on Twitter)`
          : `Deleted list "${slug}"`,
      );
      router.refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-card">
        <Table className="min-w-[40rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Owner auth</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Last polled</TableHead>
              <TableHead>List ID</TableHead>
              {canWrite ? <TableHead className="w-[5rem]">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lists.map((l) => (
              <TableRow key={l.slug}>
                <TableCell className="font-mono text-xs font-medium">{l.slug}</TableCell>
                <TableCell className="text-muted-foreground">{l.name}</TableCell>
                <TableCell>
                  {l.authUsername ? (
                    <Badge variant="secondary">@{l.authUsername}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">default owner</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{l.memberCount}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {fmtDate(l.lastPolledAt)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {l.twitterListId}
                </TableCell>
                {canWrite ? (
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busySlug === l.slug}
                      onClick={() => setPendingSlug(l.slug)}
                      title={`Delete ${l.slug}`}
                    >
                      <Trash2 className="size-3.5" />
                      {busySlug === l.slug ? "…" : "Delete"}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={pendingSlug != null}
        onOpenChange={(open) => {
          if (!open && busySlug == null) setPendingSlug(null);
        }}
        title="Delete list?"
        description={
          pendingSlug
            ? `Delete list "${pendingSlug}" on Twitter and from the database?\n\nMembers will be removed from the local mirror. This cannot be undone from here.`
            : ""
        }
        confirmLabel="Delete list"
        destructive
        loading={busySlug != null}
        onConfirm={() => {
          if (pendingSlug) void del(pendingSlug);
        }}
      />
    </>
  );
}
