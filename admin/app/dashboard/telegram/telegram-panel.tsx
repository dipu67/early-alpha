"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  Hash,
  Map as MapIcon,
  MessageSquare,
  Power,
  Send,
  Settings2,
  Star,
  Trash2,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { proxy } from "@/lib/client";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TopicPicker } from "@/components/topic-picker";
import { ALERT_TYPES, type TelegramBot, type TgConfig } from "@/lib/types";

const ALERT_META: Record<string, { label: string; hint: string }> = {
  newFollow: {
    label: "New follows",
    hint: "Influencer followed someone new",
  },
  signal: {
    label: "Signals",
    hint: "Mint / launch / TGE posts",
  },
  reclassify: {
    label: "Reclassify",
    hint: "Project type upgraded from alpha",
  },
  earlyDigest: {
    label: "Early digest",
    hint: "Daily early-project rollup",
  },
  convergence: {
    label: "Convergence",
    hint: "Multiple seeds followed same account",
  },
  search: {
    label: "Live search",
    hint: "New posts matching watched Twitter searches",
  },
  monitor: {
    label: "User monitor",
    hint: "New posts from per-user timeline monitors (@username)",
  },
  listMonitor: {
    label: "List monitors",
    hint: "New posts on watched public Twitter lists",
  },
  chainlist: {
    label: "New chains",
    hint: "New EVM chains (rpcs.json / registry detectors)",
  },
  githubRepo: {
    label: "GitHub commits",
    hint: "New commits on watched GitHub repos",
  },
  profileChange: {
    label: "Profile changes",
    hint: "Early monitor: rename / bio change on polled projects",
  },
  growthReport: {
    label: "Growth report",
    hint: "Weekly top-growing early projects board",
  },
};

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type MapRow = { slug: string; topicId: string };

function mapToRows(map: Record<string, number>): MapRow[] {
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, topicId]) => ({ slug, topicId: String(topicId) }));
}

function rowsToMap(rows: MapRow[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const slug = r.slug.trim().toLowerCase();
    if (!slug) continue;
    const n = Number(r.topicId);
    if (!Number.isFinite(n)) return null;
    out[slug] = n;
  }
  return out;
}

export function TelegramPanel({
  section = "alerts",
  initialBots,
  initialAssignments,
  initialTopicAssignments,
  initialGrokBotId = null,
  config,
  alerts,
}: {
  section?: "alerts" | "channel";
  initialBots: TelegramBot[];
  initialAssignments: Record<string, string | null>;
  initialTopicAssignments: Record<string, number | null>;
  /** Settings tg.grokBotId — bot that runs the Grok chat process */
  initialGrokBotId?: string | null;
  config: TgConfig;
  alerts: Record<string, boolean>;
}) {
  const isAlerts = section === "alerts";
  const isChannel = section === "channel";
  const [bots, setBots] = useState(initialBots);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [topicAssignments, setTopicAssignments] = useState(initialTopicAssignments);
  const [grokBotId, setGrokBotId] = useState<string | null>(initialGrokBotId);
  const [alertState, setAlertState] = useState(alerts);

  // Channel config
  const [chatId, setChatId] = useState(config.alertChatId ?? "");
  const [defaultTopic, setDefaultTopic] = useState(config.defaultTopicId?.toString() ?? "");
  const [signalTopic, setSignalTopic] = useState(config.signalTopicId?.toString() ?? "");
  const [earlyTopic, setEarlyTopic] = useState(config.earlyProjectTopicId?.toString() ?? "");
  const [interval, setIntervalMs] = useState(config.minIntervalMs?.toString() ?? "3500");
  const [retries, setRetries] = useState(config.maxRetries?.toString() ?? "5");
  const [adminIdsText, setAdminIdsText] = useState(
    () => (config.adminIds ?? []).join(", "),
  );
  const [signalRows, setSignalRows] = useState<MapRow[]>(() =>
    mapToRows(config.signalTopicMap ?? {}),
  );
  const [earlyRows, setEarlyRows] = useState<MapRow[]>(() =>
    mapToRows(config.earlyTopicMap ?? {}),
  );

  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testTopic, setTestTopic] = useState("");
  const [pendingDeleteBotId, setPendingDeleteBotId] = useState<string | null>(null);
  const [deletingBot, setDeletingBot] = useState(false);

  const activeBots = useMemo(() => bots.filter((b) => b.isActive), [bots]);
  const defaultBot = bots.find((b) => b.isDefault);

  async function refreshBots() {
    const res = await proxy("/api/tg/bots");
    if (res.ok) {
      const b = res.body as {
        items: TelegramBot[];
        assignments: Record<string, string | null>;
        topicAssignments?: Record<string, number | null>;
        grokBotId?: string | null;
      };
      setBots(b.items);
      setAssignments(b.assignments);
      if (b.topicAssignments) setTopicAssignments(b.topicAssignments);
      if (b.grokBotId !== undefined) setGrokBotId(b.grokBotId);
    }
  }

  const grokBot = bots.find((b) => b.id === grokBotId) ?? null;
  const grokByName = bots.find(
    (b) =>
      b.isActive &&
      (/grok/i.test(b.name) || (b.username != null && /grok/i.test(b.username))),
  );
  const grokResolved = grokBot ?? grokByName ?? null;

  async function addBot(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setAdding(true);
    const res = await proxy("/api/tg/bots", { method: "POST", body: { token: token.trim() } });
    setAdding(false);
    if (res.ok) {
      setToken("");
      toast.success("Bot added");
      refreshBots();
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(
        b?.error === "invalid_token" ? "Invalid token (getMe failed)" : (b?.error ?? "Failed"),
      );
    }
  }

  async function patchBot(id: string, body: unknown, ok: string) {
    const res = await proxy(`/api/tg/bots/${id}`, { method: "PATCH", body });
    if (res.ok) {
      const b = res.body as { grokBotId?: string | null };
      if (b.grokBotId !== undefined) setGrokBotId(b.grokBotId);
      toast.success(ok);
      void refreshBots();
    } else toast.error("Failed");
  }

  async function delBot(id: string) {
    setDeletingBot(true);
    const res = await proxy(`/api/tg/bots/${id}`, { method: "DELETE" });
    setDeletingBot(false);
    setPendingDeleteBotId(null);
    if (res.ok) {
      toast.success("Deleted");
      refreshBots();
    } else toast.error("Failed");
  }

  async function testBot(botId?: string, topicOverride?: number | null) {
    const res = await proxy("/api/tg/test", {
      method: "POST",
      body: {
        ...(botId ? { botId } : {}),
        ...(topicOverride != null ? { topicId: topicOverride } : {}),
      },
    });
    if (res.ok) toast.success("Test message sent");
    else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? "Failed");
    }
  }

  async function assignBot(type: string, botId: string | null) {
    setAssignments((a) => ({ ...a, [type]: botId }));
    const res = await proxy("/api/tg/assignments", {
      method: "PUT",
      body: { type, botId },
    });
    if (!res.ok) {
      toast.error("Failed to assign bot");
      refreshBots();
    }
  }

  async function assignTopic(type: string, raw: string) {
    const topicId = numOrNull(raw);
    setTopicAssignments((t) => ({ ...t, [type]: topicId }));
    const res = await proxy("/api/tg/assignments", {
      method: "PUT",
      body: { type, topicId },
    });
    if (!res.ok) {
      toast.error("Failed to save topic");
      refreshBots();
    } else {
      toast.success(
        topicId == null
          ? `${ALERT_META[type]?.label ?? type}: using default topic`
          : `${ALERT_META[type]?.label ?? type}: topic ${topicId}`,
      );
    }
  }

  async function toggleAlert(type: string, enabled: boolean) {
    setAlertState((s) => ({ ...s, [type]: enabled }));
    const res = await proxy(`/api/tg/alerts/${type}`, {
      method: "PATCH",
      body: { enabled },
    });
    if (!res.ok) {
      setAlertState((s) => ({ ...s, [type]: !enabled }));
      toast.error("Failed to toggle");
    }
  }

  async function saveConfig() {
    const signalTopicMap = rowsToMap(signalRows);
    const earlyTopicMap = rowsToMap(earlyRows);
    if (signalTopicMap === null || earlyTopicMap === null) {
      toast.error("Topic maps: every row needs a valid numeric topic id");
      return;
    }
    const adminIds = adminIdsText
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setSaving(true);
    const res = await proxy("/api/tg/config", {
      method: "PUT",
      body: {
        alertChatId: chatId.trim() || null,
        defaultTopicId: numOrNull(defaultTopic),
        signalTopicId: numOrNull(signalTopic),
        signalTopicMap,
        earlyProjectTopicId: numOrNull(earlyTopic),
        earlyTopicMap,
        minIntervalMs: numOrNull(interval),
        maxRetries: numOrNull(retries),
        adminIds,
      },
    });
    setSaving(false);
    if (res.ok) toast.success("Channel config saved");
    else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <div className="space-y-5">
      {/* Status strip — section-aware */}
      <div className={cn("grid gap-3", isAlerts ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
        {isAlerts ? (
          <>
            <StatusPill
              icon={Bot}
              label="Bots"
              value={`${activeBots.length} active`}
              sub={defaultBot ? `default · ${defaultBot.name}` : "no default bot"}
            />
            <StatusPill
              icon={MessageSquare}
              label="Alert chat"
              value={chatId ? chatId : "not set"}
              sub={defaultTopic ? `default topic ${defaultTopic}` : "set in Channel config"}
              mono
            />
          </>
        ) : (
          <>
            <StatusPill
              icon={MessageSquare}
              label="Chat"
              value={chatId ? chatId : "not set"}
              sub={defaultTopic ? `default topic ${defaultTopic}` : "no default topic"}
              mono
            />
            <StatusPill
              icon={Zap}
              label="Throttle"
              value={interval ? `${interval} ms` : "3.5s default"}
              sub={`${retries || 5} max retries on 429`}
            />
            <StatusPill
              icon={Bot}
              label="Default bot"
              value={defaultBot?.name ?? "none"}
              sub={defaultBot?.username ? `@${defaultBot.username}` : "set in Bots & alerts"}
            />
          </>
        )}
      </div>

      {isAlerts ? (
        <>
          {/* Bots */}
          <Card className="overflow-hidden border-border/80">
            <CardHeader className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-transparent to-transparent">
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4 text-primary" />
                Bots
              </CardTitle>
              <CardDescription className="mt-1">
                Tokens validated via Telegram getMe. Default bot = alerts. A{" "}
                <strong>separate</strong> bot is required for the Grok chat process (same
                token cannot poll twice).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {!grokResolved ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-950 dark:text-amber-100">
                  <p className="font-medium">Grok bot not configured</p>
                  <p className="mt-1 text-xs opacity-90">
                    API still runs; only the Grok Telegram process is skipped. Create a second
                    bot in @BotFather, paste its token below, then click{" "}
                    <strong>Use as Grok</strong> (or name it with “Grok” in the title). Restart
                    the API after assigning.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100">
                  Grok process bot:{" "}
                  <strong>
                    {grokResolved.name}
                    {grokResolved.username ? ` (@${grokResolved.username})` : ""}
                  </strong>
                  {grokBotId === grokResolved.id
                    ? " · pinned via settings"
                    : " · matched by name/username"}
                </div>
              )}

              <form
                onSubmit={addBot}
                className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-3 sm:flex-row sm:items-center"
              >
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste bot token (123456:AA…)"
                  className="flex-1 font-mono text-xs"
                />
                <Button type="submit" disabled={adding || !token.trim()}>
                  {adding ? "Validating…" : "Add bot"}
                </Button>
              </form>

              {bots.length === 0 ? (
                <EmptyState
                  title="No bots yet"
                  description="Add a BotFather token. The first bot becomes default."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {bots.map((b) => {
                    const isGrok = grokBotId === b.id;
                    return (
                    <div
                      key={b.id}
                      className="group relative flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{b.name}</div>
                          {b.username ? (
                            <div className="truncate text-xs text-muted-foreground">
                              @{b.username}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">no username</div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {b.isDefault ? <Badge>default</Badge> : null}
                          {isGrok ? <Badge variant="secondary">Grok</Badge> : null}
                          {b.isActive ? (
                            <Badge variant="success">active</Badge>
                          ) : (
                            <Badge variant="muted">off</Badge>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 truncate font-mono text-[11px] text-muted-foreground">
                        {b.token}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-1 border-t border-border/60 pt-3">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => testBot(b.id)}
                        >
                          <Send className="size-3.5" />
                          Test
                        </Button>
                        {!b.isDefault ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              patchBot(b.id, { makeDefault: true }, "Default set")
                            }
                          >
                            <Star className="size-3.5" />
                            Default
                          </Button>
                        ) : null}
                        {!isGrok ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title={
                              b.isDefault
                                ? "Prefer a second bot — default + Grok on one token will fight getUpdates"
                                : "Run Grok chat process with this bot token"
                            }
                            onClick={() => {
                              if (b.isDefault) {
                                toast.message(
                                  "Same token as default bot: main + Grok both poll — Telegram allows only one getUpdates. Use a second BotFather bot if both must run.",
                                );
                              }
                              void patchBot(b.id, { useAsGrok: true }, "Set as Grok bot — restart API");
                            }}
                          >
                            <Zap className="size-3.5" />
                            Use as Grok
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void patchBot(b.id, { useAsGrok: false }, "Grok bot cleared")
                            }
                          >
                            Clear Grok
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            patchBot(
                              b.id,
                              { isActive: !b.isActive },
                              b.isActive ? "Disabled" : "Enabled",
                            )
                          }
                        >
                          <Power className="size-3.5" />
                          {b.isActive ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingDeleteBotId(b.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Alert routing — compact table */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/60 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Hash className="size-4 text-violet-500" />
                    Alert routing
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Enable each alert, pick a bot and topic. Empty topic uses Channel default.
                  </CardDescription>
                </div>
                <Badge variant="muted" className="text-[10px]">
                  {ALERT_TYPES.filter((t) => alertState[t] ?? true).length}/{ALERT_TYPES.length}{" "}
                  on
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* Column headers — desktop */}
              <div className="hidden border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_minmax(0,1.3fr)] md:items-center md:gap-3">
                <span>Alert</span>
                <span className="text-center">Enabled</span>
                <span>Bot</span>
                <span>Topic</span>
              </div>

              <ul className="divide-y divide-border">
                {ALERT_TYPES.map((type) => {
                  const meta = ALERT_META[type] ?? { label: type, hint: "" };
                  const enabled = alertState[type] ?? true;
                  const topicVal =
                    topicAssignments[type] != null && topicAssignments[type] !== undefined
                      ? String(topicAssignments[type])
                      : "";
                  const assignedBotId = assignments[type] ?? "";
                  const assignedBot = bots.find((b) => b.id === assignedBotId);

                  return (
                    <li
                      key={type}
                      className={cn(
                        "px-3 py-3 transition-opacity sm:px-4",
                        !enabled && "bg-muted/20 opacity-55",
                      )}
                    >
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_minmax(0,1.3fr)] md:items-center md:gap-3">
                        {/* Label + accent */}
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span
                            className={cn(
                              "mt-1.5 size-2 shrink-0 rounded-full",
                              enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
                            )}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <div className="font-medium leading-tight">{meta.label}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {meta.hint}
                            </div>
                          </div>
                        </div>

                        {/* Toggle */}
                        <div className="flex items-center gap-2 md:justify-center">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground md:hidden">
                            Enabled
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={enabled}
                            aria-label={`${meta.label} ${enabled ? "enabled" : "disabled"}`}
                            onClick={() => void toggleAlert(type, !enabled)}
                            className={cn(
                              "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              enabled ? "bg-primary" : "bg-muted-foreground/30",
                            )}
                          >
                            <span
                              className={cn(
                                "absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform",
                                enabled && "translate-x-5",
                              )}
                            />
                          </button>
                          <span className="text-xs text-muted-foreground md:hidden">
                            {enabled ? "On" : "Off"}
                          </span>
                        </div>

                        {/* Bot */}
                        <div className="min-w-0 space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground md:hidden">
                            Bot
                          </span>
                          <select
                            value={assignedBotId}
                            onChange={(e) => assignBot(type, e.target.value || null)}
                            disabled={!enabled}
                            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                            title={
                              assignedBot
                                ? `${assignedBot.name}${assignedBot.username ? ` @${assignedBot.username}` : ""}`
                                : "Default bot"
                            }
                          >
                            <option value="">Default bot</option>
                            {bots.map((b) => (
                              <option
                                key={b.id}
                                value={b.id}
                                disabled={!b.isActive && assignments[type] !== b.id}
                              >
                                {b.name}
                                {b.username ? ` (@${b.username})` : ""}
                                {!b.isActive ? " · off" : ""}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Topic */}
                        <div className="min-w-0 space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground md:hidden">
                            Topic
                          </span>
                          <div className="flex items-center gap-1">
                            <TopicPicker
                              value={topicVal}
                              disabled={!enabled}
                              preferredChatId={chatId}
                              emptyLabel="Default topic"
                              compact
                              showMeta={false}
                              className="min-w-0 flex-1"
                              onChange={(v, tmeta) => {
                                if (tmeta?.groupChatId && !chatId.trim()) {
                                  setChatId(tmeta.groupChatId);
                                }
                                void assignTopic(type, v);
                              }}
                            />
                            {topicVal ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                title="Clear topic (use default)"
                                disabled={!enabled}
                                onClick={() => void assignTopic(type, "")}
                              >
                                <X className="size-3.5" />
                              </Button>
                            ) : (
                              <span className="inline-block h-8 w-8 shrink-0" aria-hidden />
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <ConfirmDialog
            open={pendingDeleteBotId != null}
            onOpenChange={(open) => {
              if (!open && !deletingBot) setPendingDeleteBotId(null);
            }}
            title="Delete bot?"
            description="Delete this bot? Alerts assigned to it will fall back to the default bot."
            confirmLabel="Delete bot"
            destructive
            loading={deletingBot}
            onConfirm={() => {
              if (pendingDeleteBotId) void delBot(pendingDeleteBotId);
            }}
          />
        </>
      ) : null}

      {isChannel ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="size-4 text-primary" />
                  Channel
                </CardTitle>
                <CardDescription>
                  Shared chat and fallback topics. Topic ids are forum{" "}
                  <code className="text-[11px]">message_thread_id</code> values.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Alert chat id">
                  <Input
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="-1001234567890"
                    className="font-mono text-xs"
                  />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Default topic">
                    <TopicPicker
                      value={defaultTopic}
                      preferredChatId={chatId}
                      emptyLabel="None"
                      onChange={(v, meta) => {
                        setDefaultTopic(v);
                        if (meta?.groupChatId && !chatId.trim()) setChatId(meta.groupChatId);
                      }}
                    />
                  </Field>
                  <Field label="Signal shared topic">
                    <TopicPicker
                      value={signalTopic}
                      preferredChatId={chatId}
                      emptyLabel="None"
                      onChange={(v, meta) => {
                        setSignalTopic(v);
                        if (meta?.groupChatId && !chatId.trim()) setChatId(meta.groupChatId);
                      }}
                    />
                  </Field>
                  <Field label="Early-project topic">
                    <TopicPicker
                      value={earlyTopic}
                      preferredChatId={chatId}
                      emptyLabel="None"
                      onChange={(v, meta) => {
                        setEarlyTopic(v);
                        if (meta?.groupChatId && !chatId.trim()) setChatId(meta.groupChatId);
                      }}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Min interval (ms)">
                    <Input
                      value={interval}
                      onChange={(e) => setIntervalMs(e.target.value)}
                      placeholder="3500"
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="Max 429 retries">
                    <Input
                      value={retries}
                      onChange={(e) => setRetries(e.target.value)}
                      placeholder="5"
                      inputMode="numeric"
                    />
                  </Field>
                </div>
                <Field label="Bot admin Telegram user IDs">
                  <Input
                    value={adminIdsText}
                    onChange={(e) => setAdminIdsText(e.target.value)}
                    placeholder="2041128532, 123456789"
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Comma-separated numeric IDs allowed to run admin commands on the
                    main Telegram bot. Saved as <code className="text-[10px]">tg.adminIds</code>.
                  </p>
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="size-4 text-primary" />
                  Send test
                </CardTitle>
                <CardDescription>
                  Verify the default bot can post into your chat / topic.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Topic (optional)">
                  <TopicPicker
                    value={testTopic}
                    preferredChatId={chatId}
                    emptyLabel="Default topic"
                    onChange={(v) => setTestTopic(v)}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => testBot(undefined, numOrNull(testTopic))}
                  >
                    <Send className="size-3.5" />
                    Send test alert
                  </Button>
                  <Button type="button" variant="outline" onClick={saveConfig} disabled={saving}>
                    <Settings2 className="size-3.5" />
                    {saving ? "Saving…" : "Save channel config"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Catalog topics come from <strong>Groups & topics</strong>. General posts without
                  a thread id.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopicMapEditor
              title="Signal topic map"
              description="Per-tag forum topics for signal alerts (overrides shared signal topic)."
              rows={signalRows}
              onChange={setSignalRows}
              preferredChatId={chatId}
            />
            <TopicMapEditor
              title="Early digest topic map"
              description="Per-tag topics for early-project digest buckets."
              rows={earlyRows}
              onChange={setEarlyRows}
              preferredChatId={chatId}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => testBot()}>
              Quick test
            </Button>
            <Button type="button" onClick={saveConfig} disabled={saving}>
              {saving ? "Saving…" : "Save channel + maps"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function StatusPill({
  icon: Icon,
  label,
  value,
  sub,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className={`mt-1 truncate text-sm font-semibold ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function TopicMapEditor({
  title,
  description,
  rows,
  onChange,
  preferredChatId,
}: {
  title: string;
  description: string;
  rows: MapRow[];
  onChange: (rows: MapRow[]) => void;
  preferredChatId?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapIcon className="size-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No rows — all tags use the shared topic.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex flex-col gap-1.5 sm:flex-row sm:items-start">
                <Input
                  value={row.slug}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...row, slug: e.target.value };
                    onChange(next);
                  }}
                  placeholder="tag slug"
                  className="h-9 flex-1 font-mono text-xs sm:max-w-[8rem]"
                />
                <TopicPicker
                  value={row.topicId}
                  preferredChatId={preferredChatId}
                  emptyLabel="Pick topic"
                  allowEmpty={false}
                  className="min-w-0 flex-1"
                  onChange={(v) => {
                    const next = [...rows];
                    next[i] = { ...row, topicId: v };
                    onChange(next);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange([...rows, { slug: "", topicId: "" }])}
        >
          <Plus className="size-3.5" />
          Add row
        </Button>
      </CardContent>
    </Card>
  );
}
