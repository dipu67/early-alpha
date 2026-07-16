"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import type { AuthAccount } from "@/lib/types";

export interface LiveTwitterList {
  listId: string;
  name: string;
  description: string | null;
  memberCount: number | null;
  subscriberCount: number | null;
  isPrivate: boolean;
  authAccountId: string;
  authUsername: string;
  projectSlug: string | null;
  listUrl: string;
}

interface LiveMember {
  userId: string;
  username: string;
  name: string;
  description: string | null;
  followersCount: number | null;
  isBlueVerified: boolean | null;
  profileImageUrl: string | null;
}

export function LiveListsManager({ authAccounts }: { authAccounts: AuthAccount[] }) {
  const canWrite = useCan("editor");
  const [items, setItems] = useState<LiveTwitterList[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Create form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [authId, setAuthId] = useState(
    () => authAccounts.find((a) => a.isActive && !a.rateLimited)?.id ?? "",
  );

  // Delete list
  const [pendingDelete, setPendingDelete] = useState<LiveTwitterList | null>(null);

  // Members dialog
  const [membersList, setMembersList] = useState<LiveTwitterList | null>(null);
  const [members, setMembers] = useState<LiveMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersBusy, setMembersBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [addUsername, setAddUsername] = useState("");
  const [pendingRemove, setPendingRemove] = useState<LiveMember | null>(null);

  const loadLists = useCallback(async () => {
    setLoading(true);
    const res = await proxy("/api/twitter-lists?activeOnly=true");
    setLoading(false);
    if (res.ok) {
      const body = res.body as { items: LiveTwitterList[]; listCount: number };
      setItems(body.items ?? []);
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Failed to load lists (${res.status})`);
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    if (!name.trim()) {
      toast.error("List name required");
      return;
    }
    if (!authId) {
      toast.error("Select owner auth account");
      return;
    }
    setBusy(true);
    const res = await proxy("/api/twitter-lists", {
      method: "POST",
      body: {
        authAccountId: authId,
        name: name.trim(),
        description: description.trim() || undefined,
        isPrivate: false,
      },
    });
    setBusy(false);
    if (res.ok) {
      toast.success("List created on Twitter");
      setName("");
      setDescription("");
      await loadLists();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function deleteList() {
    if (!canWrite || !pendingDelete) return;
    setBusy(true);
    const res = await proxy(
      `/api/twitter-lists/${encodeURIComponent(pendingDelete.listId)}?authAccountId=${encodeURIComponent(pendingDelete.authAccountId)}`,
      { method: "DELETE" },
    );
    setBusy(false);
    setPendingDelete(null);
    if (res.ok) {
      toast.success(`Deleted “${pendingDelete.name}” on Twitter`);
      if (membersList?.listId === pendingDelete.listId) setMembersList(null);
      await loadLists();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  async function openMembers(list: LiveTwitterList) {
    setMembersList(list);
    setMembers([]);
    setNextCursor(null);
    setAddUsername("");
    setMembersLoading(true);
    const res = await proxy(
      `/api/twitter-lists/${encodeURIComponent(list.listId)}/members?authAccountId=${encodeURIComponent(list.authAccountId)}&count=40`,
    );
    setMembersLoading(false);
    if (res.ok) {
      const body = res.body as {
        items: LiveMember[];
        nextCursor: string | null;
      };
      setMembers(body.items ?? []);
      setNextCursor(body.nextCursor ?? null);
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? "Failed to load members from Twitter");
    }
  }

  async function loadMoreMembers() {
    if (!membersList || !nextCursor) return;
    setMembersBusy(true);
    const res = await proxy(
      `/api/twitter-lists/${encodeURIComponent(membersList.listId)}/members?authAccountId=${encodeURIComponent(membersList.authAccountId)}&count=40&cursor=${encodeURIComponent(nextCursor)}`,
    );
    setMembersBusy(false);
    if (res.ok) {
      const body = res.body as {
        items: LiveMember[];
        nextCursor: string | null;
      };
      setMembers((prev) => [...prev, ...(body.items ?? [])]);
      setNextCursor(body.nextCursor ?? null);
    } else {
      toast.error("Failed to load more members");
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite || !membersList) return;
    const u = addUsername.trim().replace(/^@/, "");
    if (!u) {
      toast.error("Enter a username");
      return;
    }
    setMembersBusy(true);
    const res = await proxy(
      `/api/twitter-lists/${encodeURIComponent(membersList.listId)}/members`,
      {
        method: "POST",
        body: {
          authAccountId: membersList.authAccountId,
          username: u,
        },
      },
    );
    setMembersBusy(false);
    if (res.ok) {
      const b = res.body as { username?: string };
      toast.success(`Added @${b.username ?? u}`);
      setAddUsername("");
      // Re-fetch first page so list is accurate from Twitter
      await openMembers(membersList);
      await loadLists();
    } else {
      const b = res.body as { error?: string } | null;
      const err = b?.error ?? `Error ${res.status}`;
      if (err === "user_not_found") toast.error("Twitter user not found");
      else if (err === "list_daily_add_limit")
        toast.error("Twitter daily list-add limit — try again tomorrow");
      else toast.error(err);
    }
  }

  async function removeMember() {
    if (!canWrite || !membersList || !pendingRemove) return;
    setMembersBusy(true);
    const res = await proxy(
      `/api/twitter-lists/${encodeURIComponent(membersList.listId)}/members/${encodeURIComponent(pendingRemove.userId)}?authAccountId=${encodeURIComponent(membersList.authAccountId)}`,
      { method: "DELETE" },
    );
    setMembersBusy(false);
    if (res.ok) {
      toast.success(`Removed @${pendingRemove.username} from list`);
      setMembers((prev) => prev.filter((m) => m.userId !== pendingRemove.userId));
      setPendingRemove(null);
      await loadLists();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
      setPendingRemove(null);
    }
  }

  const activeAuths = authAccounts.filter((a) => a.isActive);
  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      {canWrite ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Create list on Twitter</CardTitle>
            <CardDescription>
              Creates a real X list under the selected auth account (owner). No DB write — live API
              only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={createList}
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="NFT builders"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Description
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="optional"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Owner auth
                </label>
                <select
                  value={authId}
                  onChange={(e) => setAuthId(e.target.value)}
                  required
                  className={selectClass}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {activeAuths.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.rateLimited}>
                      @{a.username}
                      {a.rateLimited ? " · limited" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || !authId} className="w-full">
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Create on X
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border/60 py-3">
          <div>
            <CardTitle className="text-base">Owned lists (live)</CardTitle>
            <CardDescription>
              From <code className="text-[11px]">getMyLists()</code> on every active auth — not the
              database.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || busy}
            onClick={() => void loadLists()}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading && items.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Fetching lists from Twitter…
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No lists on these accounts"
                description="Create one above, or check Auth Pool for active cookies."
              />
            </div>
          ) : (
            <Table className="min-w-[40rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead>List ID</TableHead>
                  <TableHead className="w-[14rem]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((l) => (
                  <TableRow key={`${l.authAccountId}-${l.listId}`}>
                    <TableCell>
                      <div className="font-medium">{l.name}</div>
                      {l.description ? (
                        <div className="line-clamp-1 text-xs text-muted-foreground">
                          {l.description}
                        </div>
                      ) : null}
                      {l.isPrivate ? (
                        <Badge variant="muted" className="mt-0.5 text-[10px]">
                          private
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">@{l.authUsername}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.memberCount ?? "—"}
                    </TableCell>
                    <TableCell>
                      <a
                        href={l.listUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 font-mono text-xs text-primary hover:underline"
                      >
                        {l.listId.slice(0, 10)}…
                        <ExternalLink className="size-3" />
                      </a>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => void openMembers(l)}
                        >
                          <Users className="size-3.5" />
                          Members
                        </Button>
                        {canWrite ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 text-destructive hover:text-destructive"
                            disabled={busy}
                            onClick={() => setPendingDelete(l)}
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
          )}
        </CardContent>
      </Card>

      {/* Members dialog — live getListMembers + remove */}
      <Dialog
        open={membersList != null}
        onOpenChange={(open) => {
          if (!open && !membersBusy) {
            setMembersList(null);
            setPendingRemove(null);
          }
        }}
      >
        <DialogContent className="max-w-lg sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4 text-violet-500" />
              {membersList?.name ?? "Members"}
            </DialogTitle>
            <DialogDescription>
              Live from Twitter
              {membersList ? (
                <>
                  {" "}
                  · owner <strong>@{membersList.authUsername}</strong>
                  {" · "}
                  <a
                    href={membersList.listUrl + "/members"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    Open on X
                  </a>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {canWrite && membersList ? (
            <form onSubmit={addMember} className="flex gap-2">
              <Input
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                placeholder="@username to add"
                className="font-mono text-xs"
                disabled={membersBusy}
              />
              <Button type="submit" size="sm" disabled={membersBusy || !addUsername.trim()}>
                {membersBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Add
              </Button>
            </form>
          ) : null}

          <div className="max-h-[min(50dvh,22rem)] overflow-y-auto rounded-lg border border-border">
            {membersLoading ? (
              <div className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading members from Twitter…
              </div>
            ) : members.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No members (or empty page).
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={`https://x.com/${m.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          @{m.username}
                        </a>
                        {m.isBlueVerified ? (
                          <Badge variant="secondary" className="text-[10px]">
                            ✓
                          </Badge>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {m.name}
                        {m.followersCount != null
                          ? ` · ${m.followersCount.toLocaleString()} followers`
                          : ""}
                      </div>
                    </div>
                    {canWrite ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 shrink-0 text-destructive hover:text-destructive"
                        disabled={membersBusy}
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
          </div>

          {nextCursor ? (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={membersBusy}
                onClick={() => void loadMoreMembers()}
              >
                {membersBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Load more
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Confirm remove member */}
      <ConfirmDialog
        open={pendingRemove != null}
        onOpenChange={(open) => {
          if (!open && !membersBusy) setPendingRemove(null);
        }}
        title="Remove from list?"
        description={
          pendingRemove && membersList
            ? `Remove @${pendingRemove.username} from “${membersList.name}” on Twitter?`
            : ""
        }
        confirmLabel="Remove from list"
        destructive
        loading={membersBusy}
        onConfirm={() => void removeMember()}
      />

      {/* Confirm delete list */}
      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingDelete(null);
        }}
        title="Delete list on Twitter?"
        description={
          pendingDelete
            ? `Permanently delete “${pendingDelete.name}” owned by @${pendingDelete.authUsername}? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete list"
        destructive
        loading={busy}
        onConfirm={() => void deleteList()}
      />
    </div>
  );
}
