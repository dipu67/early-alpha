"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopicPicker } from "@/components/topic-picker";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";

export function SendTagAlertButton({ tag }: { tag: string }) {
  const [sending, setSending] = useState(false);
  const [topic, setTopic] = useState("");
  const [open, setOpen] = useState(false);

  // Always show for debugging; only use tag if present.
  // if (!tag.trim()) return null;

  async function handleSend() {
    if (!tag.trim()) {
      toast.error("Type a tag in the filter first (e.g. nft)");
      return;
    }
    setSending(true);
    try {
      const res = await proxy("/api/projects/send-tag-alert", {
        method: "POST",
        body: {
          tag: tag.trim(),
          topicId: topic ? Number(topic) : null,
        },
      });
      const b = res.body as { error?: string; sent?: boolean; count?: number } | null;
      if (res.ok && b?.sent) {
        toast.success(`Alert sent for tag "${tag}" to topic ${topic || "default"}`);
      } else {
        toast.error(b?.error ?? `Failed (${res.status})`);
      }
    } finally {
      setSending(false);
      setOpen(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9 gap-1.5"
        onClick={() => setOpen(!open)}
        title="Send Telegram alert for this tag"
      >
        <Send className="size-3.5" />
        Send alert "{tag}" to TG
      </Button>
      {open ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 shadow-sm">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Topic:</span>
          <TopicPicker
            value={topic}
            onChange={(v) => setTopic(v)}
            compact
            className="min-w-[10rem]"
          />
          <Button size="sm" className="h-7 text-xs" disabled={sending} onClick={() => void handleSend()}>
            {sending ? <Loader2 className="size-3 animate-spin" /> : "Send"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
