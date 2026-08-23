"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";

interface TopicOption {
  id: number;
  label: string;
  isGeneral: boolean;
}

export function TopicSelectors({
  signalTopicId,
  rowTopicId,
  topics,
}: {
  signalTopicId: number | null;
  rowTopicId: number | null;
  topics: TopicOption[];
}) {
  const router = useRouter();
  const [selectedSignal, setSelectedSignal] = useState(String(signalTopicId ?? ""));
  const [selectedRow, setSelectedRow] = useState(String(rowTopicId ?? ""));
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-wrap gap-3 p-3 rounded-md border bg-card">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Signal Topic:</Label>
        <Select value={selectedSignal} onValueChange={setSelectedSignal}>
          <SelectTrigger className="h-7 w-[14rem] text-xs">
            <SelectValue placeholder="Select signal topic" />
          </SelectTrigger>
          <SelectContent>
            {topics.map((t) => (
              <SelectItem key={`sig-${t.id}`} value={String(t.id)}>
                {t.isGeneral ? "General" : t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Row Topic:</Label>
        <Select value={selectedRow} onValueChange={setSelectedRow}>
          <SelectTrigger className="h-7 w-[14rem] text-xs">
            <SelectValue placeholder="Select row topic" />
          </SelectTrigger>
          <SelectContent>
            {topics.map((t) => (
              <SelectItem key={`row-${t.id}`} value={String(t.id)}>
                {t.isGeneral ? "General" : t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        className="h-7 text-xs"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            const res = await proxy("/api/watching/config", {
              method: "PATCH",
              body: {
                signalTopicId: selectedSignal ? Number(selectedSignal) : null,
                rowTopicId: selectedRow ? Number(selectedRow) : null,
              },
            });
            if (!res.ok) {
              const detail =
                typeof res.body === "object" && res.body !== null && "error" in res.body
                  ? String((res.body as { error: unknown }).error)
                  : `HTTP ${res.status}`;
              toast.error(`Could not save topics — ${detail}`);
              return;
            }
            toast.success("Topics saved");
            router.refresh();
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving..." : "Save Topics"}
      </Button>
    </div>
  );
}
