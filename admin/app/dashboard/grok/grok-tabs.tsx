"use client";

import { useState } from "react";
import { MessageSquare, Beaker } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GrokConversationItem } from "@/lib/types";
import { GrokPanel } from "./grok-panel";
import { ResearchPanel } from "./research-panel";

export function GrokTabs({
  conversationItems,
  conversationTotal,
}: {
  conversationItems: GrokConversationItem[];
  conversationTotal: number;
}) {
  const [tab, setTab] = useState<"research" | "chats">("research");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
        <button
          type="button"
          onClick={() => setTab("research")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
            tab === "research"
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Beaker className="size-3.5" />
          Research
        </button>
        <button
          type="button"
          onClick={() => setTab("chats")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
            tab === "chats"
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <MessageSquare className="size-3.5" />
          Bot chats
        </button>
      </div>

      {tab === "research" ? (
        <ResearchPanel />
      ) : (
        <GrokPanel
          initialItems={conversationItems}
          initialTotal={conversationTotal}
        />
      )}
    </div>
  );
}
