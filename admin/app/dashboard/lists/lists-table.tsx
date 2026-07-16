"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Users, ExternalLink } from "lucide-react";
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
import { ListMembersPanel } from "./list-members-panel";
import { cn } from "@/lib/cn";

export function ListsTable({ lists: initialLists }: { lists: ProjectList[] }) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [lists, setLists] = useState(initialLists);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [manageSlug, setManageSlug] = useState<string | null>(null);

  useEffect(() => {
    setLists(initialLists);
  }, [initialLists]);

  const managing = manageSlug
    ? (lists.find((l) => l.slug === manageSlug) ?? null)
    : null;

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
      if (manageSlug === slug) setManageSlug(null);
      setLists((prev) => prev.filter((l) => l.slug !== slug));
      router.refresh();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function refreshLists() {
    const res = await proxy("/api/lists");
    if (res.ok) {
      const body = res.body as { items: ProjectList[] };
      setLists(body.items ?? []);
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Owner auth</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Last polled</TableHead>
              <TableHead>List</TableHead>
              <TableHead className="w-[12rem]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lists.map((l) => {
              const active = manageSlug === l.slug;
              return (
                <TableRow key={l.slug} className={cn(active && "bg-primary/5")}>
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
                  <TableCell>
                    <a
                      href={`https://x.com/i/lists/${l.twitterListId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-mono text-xs text-primary hover:underline"
                    >
                      {l.twitterListId.slice(0, 8)}…
                      <ExternalLink className="size-3" />
                    </a>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        type="button"
                        variant={active ? "secondary" : "outline"}
                        size="sm"
                        className="h-8"
                        onClick={() =>
                          setManageSlug((s) => (s === l.slug ? null : l.slug))
                        }
                      >
                        <Users className="size-3.5" />
                        Members
                      </Button>
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          disabled={busySlug === l.slug}
                          onClick={() => setPendingSlug(l.slug)}
                          title={`Delete ${l.slug}`}
                        >
                          <Trash2 className="size-3.5" />
                          {busySlug === l.slug ? "…" : "Delete"}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {managing ? (
        <ListMembersPanel
          list={managing}
          onClose={() => setManageSlug(null)}
          onMembersChanged={() => void refreshLists()}
        />
      ) : null}

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
    </div>
  );
}
