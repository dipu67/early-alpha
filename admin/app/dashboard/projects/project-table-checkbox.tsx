"use client";

import { useState, useCallback } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TopicPicker } from "@/components/topic-picker";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/cn";

export function ProjectTableWithCheckboxes({ items }: { items: Project[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [topic, setTopic] = useState("");

  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const selectAll = useCallback(() => {
    if (selected.length === items.length) setSelected([]);
    else setSelected(items.map((i) => i.id));
  }, [items, selected]);

  async function sendAlert() {
    if (selected.length === 0) {
      toast.error("Select at least one project");
      return;
    }
    setSending(true);
    try {
      const res = await proxy("/api/projects/send-selected-alert", {
        method: "POST",
        body: {
          ids: selected,
          topicId: topic ? Number(topic) : null,
        },
      });
      const b = res.body as { error?: string; sent?: boolean; count?: number } | null;
      if (res.ok && b?.sent) {
        toast.success(`Sent ${selected.length} project(s) to TG topic ${topic || "default"}`);
        setSelected([]);
      } else {
        toast.error(b?.error ?? `Failed (${res.status})`);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 shadow-sm">
        <Button size="sm" variant="outline" onClick={selectAll} className="h-7 text-xs">
          {selected.length === items.length ? "Deselect all" : "Select all"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {selected.length} selected
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Topic:</span>
          <TopicPicker
            value={topic}
            onChange={(v) => setTopic(v)}
            compact
            className="min-w-[10rem]"
          />
        </div>
        <Button size="sm" disabled={sending || selected.length === 0} onClick={() => void sendAlert()} className="h-7 text-xs gap-1">
          {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
          Send to TG
        </Button>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-8 text-left">
                <Checkbox
                  checked={items.length > 0 && selected.length === items.length}
                  onCheckedChange={() => selectAll()}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-left">Tags</th>
              <th className="px-3 py-2 text-right">Followers</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-border/60 hover:bg-muted/20">
                <td className="px-3 py-2">
                  <Checkbox
                    checked={selected.includes(p.id)}
                    onCheckedChange={() => toggle(p.id)}
                    aria-label={`Select @${p.username}`}
                  />
                </td>
                <td className="px-3 py-2 font-medium text-primary">
                    <a
                      href={`https://x.com/${p.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      @{p.username}
                    </a>
                  </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{p.tags.join(", ") || "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{p.followersCount ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
