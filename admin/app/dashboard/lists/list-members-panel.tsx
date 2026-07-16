"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, UserMinus, Users, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/cn";
import { fmtDate, type ProjectList } from "@/lib/types";

export interface ListMemberRow {
  accountId: string;
  username: string;
  name: string;
  tags: string[];
  followersCount: number | null;
  addedAt: string;
}

export function ListMembersPanel({
  list,
  onClose,
  onMembersChanged,
}: {
  list: ProjectList;
  onClose: () => void;
  /** Called after add/remove so parent can refresh counts. */
  onMembersChanged?: () => void;
}) {
  const canWrite = useCan("editor");
  const [members, setMembers] = useState<ListMemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [pendingRemove, setPendingRemove] = useState<ListMemberRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await proxy(
      `/api/lists/${encodeURIComponent(list.slug)}/members?limit=100&offset=0`,
    );
    setLoading(false);
    if (res.ok) {
      const body = res.body as { items: ListMemberRow[]; total: number };
      setMembers(body.items ?? []);
      setTotal(body.total ?? 0);
    } else {
      toast.error("Failed to load members");
    }
  }, [list.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    const u = username.trim().replace(/^@/, "");
    if (!u) {
      toast.error("Enter a username");
      return;
    }
    setBusy(true);
    const res = await proxy(`/api/lists/${encodeURIComponent(list.slug)}/members`, {
      method: "POST",
      body: { username: u },
    });
    setBusy(false);
    if (res.ok) {
      const b = res.body as { alreadyMember?: boolean; username?: string };
      toast.success(
        b.alreadyMember
          ? `@${b.username ?? u} is already on this list`
          : `Added @${b.username ?? u}`,
      );
      setUsername("");
      await load();
      onMembersChanged?.();
    } else {
      const b = res.body as { error?: string } | null;
      const err = b?.error ?? `Error ${res.status}`;
      if (err === "user_not_found") toast.error("Twitter user not found");
      else if (err === "list_daily_add_limit")
        toast.error("Twitter daily list-add limit hit — try again tomorrow");
      else if (err === "list_not_found") toast.error("List not found");
      else toast.error(err);
    }
  }

  async function removeMember(row: ListMemberRow) {
    if (!canWrite) return;
    setBusy(true);
    const res = await proxy(
      `/api/lists/${encodeURIComponent(list.slug)}/members/${encodeURIComponent(row.accountId)}`,
      { method: "DELETE" },
    );
    setBusy(false);
    setPendingRemove(null);
    if (res.ok) {
      toast.success(`Removed @${row.username}`);
      await load();
      onMembersChanged?.();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Users className="size-4 text-violet-500" />
            <h3 className="font-medium">
              Members · <span className="font-mono text-sm">{list.slug}</span>
            </h3>
            <Badge variant="secondary">{total}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {list.name}
            {list.authUsername ? (
              <>
                {" "}
                · owner <strong className="text-foreground">@{list.authUsername}</strong>
              </>
            ) : null}
            {" · "}
            <a
              href={`https://x.com/i/lists/${list.twitterListId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              Open on X <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          <X className="size-3.5" />
          Close
        </Button>
      </div>

      <div className="space-y-3 p-4">
        {canWrite ? (
          <form onSubmit={addMember} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Add member by username
              </label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@projectaccount"
                className="font-mono text-xs"
                disabled={busy}
              />
            </div>
            <Button type="submit" disabled={busy || !username.trim()} className="shrink-0">
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Add to list
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Editor+ required to change members.</p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading members…
          </div>
        ) : members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No members yet. Add a username above, or run Reconcile to fill from tags.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {members.map((m) => (
              <li
                key={m.accountId}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5",
                  "bg-card",
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`https://x.com/${m.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      @{m.username}
                    </a>
                    <span className="truncate text-xs text-muted-foreground">{m.name}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    {m.followersCount != null ? (
                      <span>{m.followersCount.toLocaleString()} followers</span>
                    ) : null}
                    <span>added {fmtDate(m.addedAt)}</span>
                    {m.tags?.length ? (
                      <span className="font-mono">{m.tags.join(", ")}</span>
                    ) : null}
                  </div>
                </div>
                {canWrite ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => setPendingRemove(m)}
                  >
                    <UserMinus className="size-3.5" />
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {total > members.length ? (
          <p className="text-xs text-muted-foreground">
            Showing {members.length} of {total} members.
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingRemove != null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingRemove(null);
        }}
        title="Remove member?"
        description={
          pendingRemove
            ? `Remove @${pendingRemove.username} from list "${list.slug}" on Twitter and in the database?`
            : ""
        }
        confirmLabel="Remove member"
        destructive
        loading={busy}
        onConfirm={() => {
          if (pendingRemove) void removeMember(pendingRemove);
        }}
      />
    </div>
  );
}
