"use client";

import { useState } from "react";
import { FolderKanban, Bot, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TelegramBot, TgConfig } from "@/lib/types";
import { GroupManager } from "./group-manager";
import { TelegramPanel } from "./telegram-panel";

type Tab = "groups" | "alerts" | "channel";

export function TelegramTabs({
  initialBots,
  initialAssignments,
  initialTopicAssignments,
  initialGrokBotId = null,
  config,
  alerts,
}: {
  initialBots: TelegramBot[];
  initialAssignments: Record<string, string | null>;
  initialTopicAssignments: Record<string, number | null>;
  initialGrokBotId?: string | null;
  config: TgConfig;
  alerts: Record<string, boolean>;
}) {
  const [tab, setTab] = useState<Tab>("groups");

  const tabs: { id: Tab; label: string; icon: typeof Bot; hint: string }[] = [
    { id: "groups", label: "Groups & topics", icon: FolderKanban, hint: "Forum catalog" },
    { id: "alerts", label: "Bots & alerts", icon: Bot, hint: "Routing" },
    { id: "channel", label: "Channel config", icon: Settings2, hint: "Chat + maps" },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors sm:flex-none sm:justify-start",
                on
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{t.label}</span>
              <span className="hidden text-[10px] text-muted-foreground sm:inline">
                {t.hint}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "groups" ? <GroupManager /> : null}
      {tab === "alerts" || tab === "channel" ? (
        <TelegramPanel
          section={tab === "alerts" ? "alerts" : "channel"}
          initialBots={initialBots}
          initialAssignments={initialAssignments}
          initialTopicAssignments={initialTopicAssignments}
          initialGrokBotId={initialGrokBotId}
          config={config}
          alerts={alerts}
        />
      ) : null}
    </div>
  );
}
