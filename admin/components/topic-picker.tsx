"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { proxy } from "@/lib/client";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

export type CatalogTopic = {
  messageThreadId: number;
  name: string;
  isClosed: boolean;
  isGeneral: boolean;
  groupChatId: string;
  groupTitle: string | null;
};

type GroupPayload = {
  id: string;
  chatId: string;
  title: string | null;
  isForum: boolean;
  topics: {
    messageThreadId: number;
    name: string;
    isClosed: boolean;
    isGeneral: boolean;
  }[];
};

/**
 * Select a forum topic from the Group Manager catalog.
 * Value is Telegram `message_thread_id` as string (or "" for default/none).
 * General (id 1) is stored as "1" but sends without thread id on the backend.
 */
export function TopicPicker({
  value,
  onChange,
  disabled,
  className,
  preferredChatId,
  allowEmpty = true,
  emptyLabel = "Default / none",
  allowManual = true,
  compact = false,
  showMeta = true,
}: {
  value: string;
  onChange: (threadId: string, meta?: CatalogTopic | null) => void;
  disabled?: boolean;
  className?: string;
  preferredChatId?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  allowManual?: boolean;
  /** Single-line control (hides helper text; denser for tables). */
  compact?: boolean;
  /** Show selected group/thread subtitle under the control. Default true. */
  showMeta?: boolean;
}) {
  const [groups, setGroups] = useState<GroupPayload[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [manual, setManual] = useState(false);

  const load = useCallback(async () => {
    const res = await proxy("/api/tg/groups");
    if (res.ok) {
      const body = res.body as { items: GroupPayload[] };
      setGroups(Array.isArray(body.items) ? body.items : []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const options = useMemo(() => {
    const pref = preferredChatId?.trim();
    const list = groups.flatMap((g) =>
      (g.topics ?? []).map((t) => ({
        messageThreadId: t.messageThreadId,
        name: t.name,
        isClosed: t.isClosed,
        isGeneral: t.isGeneral || t.messageThreadId === 1,
        groupChatId: g.chatId,
        groupTitle: g.title,
      })),
    );
    list.sort((a, b) => {
      const aMatch = pref && a.groupChatId === pref ? 0 : 1;
      const bMatch = pref && b.groupChatId === pref ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      if (a.isGeneral !== b.isGeneral) return a.isGeneral ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [groups, preferredChatId]);

  useEffect(() => {
    if (!loaded || !value) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const found = options.some((o) => o.messageThreadId === n);
    if (!found) setManual(true);
  }, [loaded, value, options]);

  const inCatalog = useMemo(() => {
    if (!value) return true;
    const n = Number(value);
    return Number.isFinite(n) && options.some((o) => o.messageThreadId === n);
  }, [value, options]);

  const selectValue = !value ? "" : inCatalog && !manual ? value : "__manual__";

  const selectedMeta = useMemo(() => {
    if (!value) return null;
    return options.find((o) => String(o.messageThreadId) === value) ?? null;
  }, [value, options]);

  const controlClass = cn(
    "flex w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    compact ? "h-8 text-xs" : "h-9",
  );

  return (
    <div className={cn("flex w-full min-w-0 flex-col", compact ? "gap-0.5" : "gap-1.5", className)}>
      {manual || selectValue === "__manual__" ? (
        <>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value, null)}
            disabled={disabled}
            placeholder="thread id"
            inputMode="numeric"
            className={cn(controlClass, "font-mono")}
          />
          {!compact ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                disabled={disabled || options.length === 0}
                onClick={() => {
                  setManual(false);
                  if (value && !options.some((o) => String(o.messageThreadId) === value)) {
                    onChange("", null);
                  }
                }}
              >
                {options.length === 0 ? "No topics catalogued yet" : "← Pick from catalog"}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled || options.length === 0}
              className="self-start text-[10px] text-primary hover:underline disabled:opacity-50"
              onClick={() => {
                setManual(false);
                if (value && !options.some((o) => String(o.messageThreadId) === value)) {
                  onChange("", null);
                }
              }}
            >
              catalog
            </button>
          )}
        </>
      ) : (
        <select
          value={selectValue}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__manual__") {
              setManual(true);
              return;
            }
            if (v === "") {
              onChange("", null);
              return;
            }
            const meta = options.find((o) => String(o.messageThreadId) === v) ?? null;
            onChange(v, meta);
          }}
          className={controlClass}
        >
          {allowEmpty ? <option value="">{emptyLabel}</option> : null}
          {!loaded ? (
            <option value="" disabled>
              Loading…
            </option>
          ) : null}
          {loaded && options.length === 0 ? (
            <option value="" disabled>
              No topics — use Groups tab
            </option>
          ) : null}
          {groupOptions(options).map((g) => (
            <optgroup
              key={g.chatId}
              label={`${g.title || g.chatId}${preferredChatId === g.chatId ? " ★" : ""}`}
            >
              {g.topics.map((t) => (
                <option
                  key={`${g.chatId}-${t.messageThreadId}`}
                  value={String(t.messageThreadId)}
                >
                  {t.isGeneral ? "🏠 " : ""}
                  {t.name}
                  {t.isClosed ? " (closed)" : ""}
                  {t.isGeneral ? " · General" : ` · #${t.messageThreadId}`}
                </option>
              ))}
            </optgroup>
          ))}
          {allowManual ? <option value="__manual__">Custom id…</option> : null}
        </select>
      )}

      {showMeta && !compact && selectedMeta ? (
        <p className="truncate text-[11px] text-muted-foreground">
          {selectedMeta.groupTitle || selectedMeta.groupChatId}
          {" · "}
          {selectedMeta.isGeneral
            ? "General (sends without thread id)"
            : `thread ${selectedMeta.messageThreadId}`}
        </p>
      ) : showMeta && !compact && value && !manual ? (
        <p className="font-mono text-[11px] text-muted-foreground">id {value}</p>
      ) : null}
    </div>
  );
}

function groupOptions(options: CatalogTopic[]) {
  const map = new Map<
    string,
    { chatId: string; title: string | null; topics: CatalogTopic[] }
  >();
  for (const o of options) {
    let g = map.get(o.groupChatId);
    if (!g) {
      g = { chatId: o.groupChatId, title: o.groupTitle, topics: [] };
      map.set(o.groupChatId, g);
    }
    g.topics.push(o);
  }
  return [...map.values()];
}
