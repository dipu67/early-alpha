"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FolderKanban,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  Lock,
  Unlock,
  Send,
  Loader2,
  Hash,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { useCan } from "@/components/role-context";
import { cn } from "@/lib/cn";

type TgTopic = {
  id: string;
  messageThreadId: number;
  name: string;
  isClosed: boolean;
  isHidden: boolean;
  isGeneral: boolean;
};

type TgGroup = {
  id: string;
  chatId: string;
  title: string | null;
  type: string;
  isForum: boolean;
  username: string | null;
  notes: string | null;
  topicCount: number;
  topics: TgTopic[];
};

export function GroupManager() {
  const canAdmin = useCan("admin");
  const [groups, setGroups] = useState<TgGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatIdInput, setChatIdInput] = useState("");
  const [newTopicName, setNewTopicName] = useState("");
  const [registerThreadId, setRegisterThreadId] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [renameMap, setRenameMap] = useState<Record<number, string>>({});
  const [sendMap, setSendMap] = useState<Record<number, string>>({});
  const [expandedSend, setExpandedSend] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    kind: "group" | "topic";
    groupId: string;
    threadId?: number;
    label: string;
  } | null>(null);

  const selected = groups.find((g) => g.id === selectedId) ?? null;

  const load = useCallback(async () => {
    const res = await proxy("/api/tg/groups");
    if (res.ok) {
      const body = res.body as { items: TgGroup[] };
      setGroups(body.items);
      if (selectedId && !body.items.some((g) => g.id === selectedId)) {
        setSelectedId(body.items[0]?.id ?? null);
      } else if (!selectedId && body.items[0]) {
        setSelectedId(body.items[0].id);
      }
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function registerGroup() {
    if (!chatIdInput.trim()) {
      toast.error("Chat id required (e.g. -100…)");
      return;
    }
    setBusy(true);
    try {
      const res = await proxy("/api/tg/groups", {
        method: "POST",
        body: { chatId: chatIdInput.trim() },
      });
      if (res.ok) {
        const g = res.body as TgGroup;
        toast.success(`Registered ${g.title ?? g.chatId}`);
        setChatIdInput("");
        await load();
        setSelectedId(g.id);
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? `Error ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function createTopic() {
    if (!selected || !newTopicName.trim()) return;
    setBusy(true);
    try {
      const res = await proxy(`/api/tg/groups/${selected.id}/topics`, {
        method: "POST",
        body: { name: newTopicName.trim() },
      });
      if (res.ok) {
        toast.success("Topic created");
        setNewTopicName("");
        await load();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? "Create failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function registerTopic() {
    if (!selected) return;
    const tid = Number(registerThreadId);
    if (!Number.isFinite(tid) || !registerName.trim()) {
      toast.error("thread id + name required");
      return;
    }
    setBusy(true);
    try {
      const res = await proxy(`/api/tg/groups/${selected.id}/topics/register`, {
        method: "POST",
        body: { messageThreadId: tid, name: registerName.trim() },
      });
      if (res.ok) {
        toast.success("Topic registered in catalog");
        setRegisterThreadId("");
        setRegisterName("");
        await load();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? "Register failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function patchTopic(
    threadId: number,
    body: Record<string, unknown>,
    okMsg: string,
  ) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await proxy(
        `/api/tg/groups/${selected.id}/topics/${threadId}`,
        { method: "PATCH", body },
      );
      if (res.ok) {
        toast.success(okMsg);
        await load();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? "Failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendInTopic(threadId: number) {
    if (!selected) return;
    const text = sendMap[threadId]?.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await proxy(
        `/api/tg/groups/${selected.id}/topics/${threadId}/send`,
        { method: "POST", body: { text } },
      );
      if (res.ok) {
        toast.success("Sent");
        setSendMap((m) => ({ ...m, [threadId]: "" }));
        setExpandedSend(null);
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? "Send failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (pendingDelete.kind === "group") {
        const res = await proxy(`/api/tg/groups/${pendingDelete.groupId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          toast.success("Group removed from catalog");
          setPendingDelete(null);
          setSelectedId(null);
          await load();
        } else toast.error("Delete failed");
      } else if (pendingDelete.threadId != null) {
        const res = await proxy(
          `/api/tg/groups/${pendingDelete.groupId}/topics/${pendingDelete.threadId}`,
          { method: "DELETE" },
        );
        if (res.ok) {
          toast.success("Topic deleted on Telegram");
          setPendingDelete(null);
          await load();
        } else {
          const b = res.body as { error?: string } | null;
          toast.error(b?.error ?? "Delete failed");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (!canAdmin) {
    return (
      <p className="text-sm text-muted-foreground">Admin only — group management.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Compact toolbar */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FolderKanban className="size-4 text-primary" />
          <span>Catalog</span>
          <Badge variant="muted" className="text-[10px]">
            {groups.length} groups
          </Badge>
        </div>
        <div className="hidden h-4 w-px bg-border sm:block" />
        <Input
          value={chatIdInput}
          onChange={(e) => setChatIdInput(e.target.value)}
          placeholder="chat id (-100…)"
          className="h-9 w-full font-mono text-xs sm:w-48"
        />
        <Button type="button" size="sm" disabled={busy} onClick={() => void registerGroup()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Register
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
        <p className="text-[11px] text-muted-foreground sm:ml-auto">
          Bot API can’t list topics — catalog via events + register ·{" "}
          <code className="text-[10px]">/register_group</code>
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        {/* Group list */}
        <Card className="overflow-hidden lg:col-span-4">
          <CardHeader className="border-b border-border/60 py-3">
            <CardTitle className="text-sm">Groups</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {groups.length === 0 ? (
              <EmptyState
                title="No groups"
                description="Register a chat id or run /register_group in Telegram."
              />
            ) : (
              <ul className="max-h-[min(28rem,60vh)] space-y-0.5 overflow-y-auto">
                {groups.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(g.id)}
                      className={cn(
                        "w-full rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        selectedId === g.id
                          ? "bg-primary/10 ring-1 ring-primary/30"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{g.title ?? g.chatId}</span>
                        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                          {g.topicCount}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {g.chatId}
                        </span>
                        {g.isForum ? (
                          <Badge variant="success" className="h-4 px-1 text-[9px]">
                            forum
                          </Badge>
                        ) : (
                          <Badge variant="muted" className="h-4 px-1 text-[9px]">
                            {g.type}
                          </Badge>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Topics panel */}
        <Card className="overflow-hidden lg:col-span-8">
          <CardHeader className="border-b border-border/60 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="truncate text-sm">
                  {selected ? selected.title ?? selected.chatId : "Topics"}
                </CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  {selected
                    ? `${selected.chatId} · ${selected.topics.length} topics`
                    : "Select a group"}
                </CardDescription>
              </div>
              {selected ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 shrink-0 text-destructive"
                  onClick={() =>
                    setPendingDelete({
                      kind: "group",
                      groupId: selected.id,
                      label: selected.title ?? selected.chatId,
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                  <span className="hidden sm:inline">Remove</span>
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-3">
            {!selected ? (
              <EmptyState title="No group selected" description="Pick a group on the left." />
            ) : (
              <>
                {/* Create + register row */}
                <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <Input
                    value={newTopicName}
                    onChange={(e) => setNewTopicName(e.target.value)}
                    placeholder="New topic name"
                    className="h-8 flex-1 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createTopic();
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    disabled={busy || !newTopicName.trim()}
                    onClick={() => void createTopic()}
                  >
                    <Plus className="size-3.5" />
                    Create
                  </Button>
                  <div className="hidden h-5 w-px bg-border sm:block" />
                  <Input
                    value={registerThreadId}
                    onChange={(e) => setRegisterThreadId(e.target.value)}
                    placeholder="thread #"
                    className="h-8 w-full font-mono text-xs sm:w-20"
                    inputMode="numeric"
                  />
                  <Input
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    placeholder="catalog name"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={busy}
                    onClick={() => void registerTopic()}
                  >
                    <Hash className="size-3.5" />
                    Register
                  </Button>
                </div>

                {selected.topics.length === 0 ? (
                  <EmptyState
                    title="No topics in catalog"
                    description="Create one, or register an existing thread id."
                  />
                ) : (
                  <ul className="max-h-[min(32rem,65vh)] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {selected.topics.map((t) => {
                      const renameVal = renameMap[t.messageThreadId] ?? t.name;
                      const dirty = renameVal !== t.name;
                      const showSend = expandedSend === t.messageThreadId;
                      return (
                        <li key={t.messageThreadId} className="bg-card px-2.5 py-2 text-sm">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                              <Input
                                value={renameVal}
                                onChange={(e) =>
                                  setRenameMap((m) => ({
                                    ...m,
                                    [t.messageThreadId]: e.target.value,
                                  }))
                                }
                                className="h-7 max-w-[14rem] flex-1 border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none hover:border-input focus:border-input"
                              />
                              <Badge variant="muted" className="h-5 font-mono text-[10px]">
                                {t.messageThreadId}
                              </Badge>
                              {t.isGeneral ? (
                                <Badge variant="secondary" className="h-5 text-[10px]">
                                  general
                                </Badge>
                              ) : null}
                              {t.isClosed ? (
                                <Badge variant="destructive" className="h-5 text-[10px]">
                                  closed
                                </Badge>
                              ) : null}
                              {t.isHidden ? (
                                <Badge variant="muted" className="h-5 text-[10px]">
                                  hidden
                                </Badge>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center gap-0.5">
                              {dirty ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-2"
                                  disabled={busy}
                                  onClick={() =>
                                    void patchTopic(
                                      t.messageThreadId,
                                      { name: renameVal },
                                      "Renamed",
                                    )
                                  }
                                >
                                  <Pencil className="size-3" />
                                  Save
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                disabled={busy}
                                title={t.isClosed ? "Reopen" : "Close"}
                                onClick={() =>
                                  void patchTopic(
                                    t.messageThreadId,
                                    { action: t.isClosed ? "reopen" : "close" },
                                    t.isClosed ? "Reopened" : "Closed",
                                  )
                                }
                              >
                                {t.isClosed ? (
                                  <Unlock className="size-3.5" />
                                ) : (
                                  <Lock className="size-3.5" />
                                )}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className={cn("h-7 px-2", showSend && "bg-muted")}
                                disabled={busy}
                                title="Send message"
                                onClick={() =>
                                  setExpandedSend(showSend ? null : t.messageThreadId)
                                }
                              >
                                <Send className="size-3.5" />
                              </Button>
                              {!t.isGeneral ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-destructive hover:text-destructive"
                                  disabled={busy}
                                  title="Delete topic"
                                  onClick={() =>
                                    setPendingDelete({
                                      kind: "topic",
                                      groupId: selected.id,
                                      threadId: t.messageThreadId,
                                      label: t.name,
                                    })
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </div>

                          {showSend ? (
                            <div className="mt-2 flex gap-1.5">
                              <Input
                                value={sendMap[t.messageThreadId] ?? ""}
                                onChange={(e) =>
                                  setSendMap((m) => ({
                                    ...m,
                                    [t.messageThreadId]: e.target.value,
                                  }))
                                }
                                placeholder="Message to this topic…"
                                className="h-8 flex-1 text-xs"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void sendInTopic(t.messageThreadId);
                                  if (e.key === "Escape") setExpandedSend(null);
                                }}
                              />
                              <Button
                                type="button"
                                size="sm"
                                className="h-8"
                                disabled={busy || !(sendMap[t.messageThreadId] ?? "").trim()}
                                onClick={() => void sendInTopic(t.messageThreadId)}
                              >
                                Send
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!busy && !o) setPendingDelete(null);
        }}
        title={
          pendingDelete?.kind === "group"
            ? "Remove group from catalog?"
            : `Delete topic “${pendingDelete?.label}”?`
        }
        description={
          pendingDelete?.kind === "group"
            ? "Removes the group from the admin catalog only. The bot stays in the Telegram chat."
            : "Deletes the topic and all messages on Telegram (requires can_delete_messages)."
        }
        confirmLabel={pendingDelete?.kind === "group" ? "Remove" : "Delete topic"}
        destructive
        loading={busy}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
