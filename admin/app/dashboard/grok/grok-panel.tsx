"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  RefreshCw,
  Sparkles,
  Trash2,
  Power,
  Filter,
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
import { fmtDate, type GrokConversationDetail, type GrokConversationItem } from "@/lib/types";
import { cn } from "@/lib/cn";

type PendingDelete =
  | null
  | { kind: "one"; id: string; title: string; onX: boolean }
  | { kind: "all"; onX: boolean };

export function GrokPanel({
  initialItems,
  initialTotal,
}: {
  initialItems: GrokConversationItem[];
  initialTotal: number;
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const canAdmin = useCan("admin");

  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItems.find((i) => i.isActive)?.id ?? initialItems[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<GrokConversationDetail | null>(null);
  const [chatFilter, setChatFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pending, setPending] = useState<PendingDelete>(null);

  useEffect(() => {
    setItems(initialItems);
    setTotal(initialTotal);
  }, [initialItems, initialTotal]);

  async function refreshList() {
    const q: Record<string, string> = { limit: "100" };
    if (chatFilter.trim()) q.chatId = chatFilter.trim();
    if (activeOnly) q.active = "true";
    const res = await proxy(
      `/api/grok/conversations?${new URLSearchParams(q).toString()}`,
    );
    if (res.ok) {
      const body = res.body as { items: GrokConversationItem[]; total: number };
      setItems(body.items);
      setTotal(body.total);
      if (selectedId && !body.items.some((i) => i.id === selectedId)) {
        setSelectedId(body.items[0]?.id ?? null);
      }
    } else {
      toast.error("Failed to load conversations");
    }
  }

  async function loadDetail(id: string) {
    setLoadingDetail(true);
    try {
      const res = await proxy(`/api/grok/conversations/${id}?limit=200`);
      if (res.ok) {
        setDetail(res.body as GrokConversationDetail);
      } else {
        setDetail(null);
        toast.error("Failed to load transcript");
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function activate(id: string) {
    if (!canWrite) return;
    setBusy(true);
    try {
      const res = await proxy(`/api/grok/conversations/${id}/activate`, {
        method: "POST",
        body: {},
      });
      if (res.ok) {
        toast.success("Set as active for that Telegram chat");
        await refreshList();
        await loadDetail(id);
        router.refresh();
      } else {
        const b = res.body as { error?: string } | null;
        toast.error(b?.error ?? `Error ${res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    if (!pending || !canWrite) return;
    setBusy(true);
    try {
      if (pending.kind === "one") {
        const qs = pending.onX ? "?onX=true" : "";
        const res = await proxy(`/api/grok/conversations/${pending.id}${qs}`, {
          method: "DELETE",
        });
        if (res.ok) {
          const b = res.body as { xDeleted?: boolean | null; xError?: string | null };
          toast.success(
            b.xDeleted
              ? "Deleted from DB and X"
              : b.xError
                ? `Deleted from DB (X: ${b.xError})`
                : "Deleted from DB",
          );
          setPending(null);
          if (selectedId === pending.id) setSelectedId(null);
          await refreshList();
          router.refresh();
        } else {
          const b = res.body as { error?: string } | null;
          toast.error(b?.error ?? `Error ${res.status}`);
        }
      } else {
        const params = new URLSearchParams();
        if (chatFilter.trim()) params.set("chatId", chatFilter.trim());
        if (pending.onX) params.set("onX", "true");
        const res = await proxy(
          `/api/grok/conversations?${params.toString()}`,
          { method: "DELETE" },
        );
        if (res.ok) {
          const b = res.body as { deleted?: number };
          toast.success(`Deleted ${b.deleted ?? 0} conversation(s)`);
          setPending(null);
          setSelectedId(null);
          setDetail(null);
          await refreshList();
          router.refresh();
        } else {
          const b = res.body as { error?: string } | null;
          toast.error(b?.error ?? `Error ${res.status}`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="size-4" />
            Filters
          </CardTitle>
          <CardDescription>
            Filter by Telegram chat id. Conversations are created by the Grok bot
            (/newchat or first message).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            value={chatFilter}
            onChange={(e) => setChatFilter(e.target.value)}
            placeholder="telegram chat id"
            className="w-full font-mono text-xs sm:w-52"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="rounded border-input"
            />
            Active only
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void refreshList()}
          >
            <RefreshCw className="size-3.5" />
            Apply
          </Button>
          {canAdmin ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy || items.length === 0}
              onClick={() => setPending({ kind: "all", onX: false })}
            >
              <Trash2 className="size-3.5" />
              Delete listed
            </Button>
          ) : null}
          <span className="text-sm text-muted-foreground">{total} total</span>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Conversations
            </CardTitle>
            <CardDescription>{items.length} shown</CardDescription>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <EmptyState
                title="No conversations"
                description="Talk to the Grok Telegram bot or run /newchat."
              />
            ) : (
              <ul className="max-h-[min(28rem,60dvh)] space-y-1 overflow-y-auto">
                {items.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={cn(
                          "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                          active
                            ? "border-primary/40 bg-primary/10"
                            : "border-border hover:bg-muted/40",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-medium">#{c.id}</span>
                          {c.isActive ? (
                            <Badge variant="success" className="text-[10px]">
                              active
                            </Badge>
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              idle
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px]">
                            {c.chatType}
                          </Badge>
                        </div>
                        <div className="mt-0.5 truncate text-sm">
                          {c.title || "Untitled"}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          chat {c.telegramChatId}
                        </div>
                        <div className="mt-1 flex justify-between gap-2 text-[10px] text-muted-foreground">
                          <span>{c.messageCount} msgs</span>
                          <span>{fmtDate(c.lastMessageAt ?? c.createdAt)}</span>
                        </div>
                        {c.preview ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">
                              {c.preview.role === "user" ? "You" : "Grok"}:
                            </span>{" "}
                            {c.preview.content}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="size-4" />
                  {selected ? `Conversation #${selected.id}` : "Transcript"}
                </CardTitle>
                <CardDescription className="break-all">
                  {selected
                    ? `${selected.title ?? "Untitled"} · Grok ${selected.grokConversationId}`
                    : "Select a conversation on the left."}
                </CardDescription>
              </div>
              {selected && canWrite ? (
                <div className="flex flex-wrap gap-1.5">
                  {!selected.isActive ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void activate(selected.id)}
                    >
                      <Power className="size-3.5" />
                      Activate
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setPending({
                        kind: "one",
                        id: selected.id,
                        title: selected.title ?? `#${selected.id}`,
                        onX: false,
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      setPending({
                        kind: "one",
                        id: selected.id,
                        title: selected.title ?? `#${selected.id}`,
                        onX: true,
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                    Delete + X
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedId ? (
              <EmptyState title="Nothing selected" description="Pick a conversation." />
            ) : loadingDetail ? (
              <p className="text-sm text-muted-foreground">Loading transcript…</p>
            ) : !detail ? (
              <EmptyState title="Could not load" description="Try selecting again." />
            ) : detail.messages.length === 0 ? (
              <EmptyState
                title="No messages yet"
                description="Transcript fills when the bot is used."
              />
            ) : (
              <div className="max-h-[min(32rem,65dvh)] space-y-3 overflow-y-auto pr-1">
                {detail.messages.map((m) => {
                  const isUser = m.role === "user";
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm",
                        isUser
                          ? "ml-0 mr-4 border-border bg-muted/30 sm:mr-12"
                          : "ml-4 mr-0 border-primary/20 bg-primary/5 sm:ml-12",
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>{isUser ? "User" : "Grok"}</span>
                        <span className="normal-case">{fmtDate(m.createdAt)}</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!busy && !open) setPending(null);
        }}
        title={
          pending?.kind === "all"
            ? "Delete conversations?"
            : pending
              ? `Delete ${pending.title}?`
              : "Delete?"
        }
        description={
          pending?.kind === "all"
            ? `Permanently delete ${chatFilter.trim() ? "filtered" : "all"} conversations${pending.onX ? " (and try X)" : ""} from the database. Message history is removed.`
            : pending
              ? `Remove conversation and its message transcript from the database.${
                  pending.onX
                    ? "\n\nAlso attempts to delete the conversation on X/Grok."
                    : ""
                }`
              : ""
        }
        confirmLabel={pending?.onX ? "Delete + X" : "Delete"}
        destructive
        loading={busy}
        onConfirm={runDelete}
      />
    </div>
  );
}
