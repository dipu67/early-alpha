"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { TopicPicker } from "@/components/topic-picker";
import { useCan } from "@/components/role-context";
import { proxy } from "@/lib/client";
import { toast } from "@/components/ui/sonner";
import { fmtNum, type GrowthBoardRow } from "@/lib/types";
import { Activity, Loader2 } from "lucide-react";

const DAY_OPTIONS = [1, 3, 7, 14, 30];

export function GrowthPanel({
  initialItems,
  initialDays,
  initialTop,
}: {
  initialItems: GrowthBoardRow[];
  initialDays: number;
  initialTop: number;
}) {
  const router = useRouter();
  const canWrite = useCan("editor");
  const [days, setDays] = useState(initialDays);
  const [top, setTop] = useState(initialTop);
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState(false);
  const [topicId, setTopicId] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadGrowth() {
    setLoading(true);
    const url = `/api/growth/stats?days=${days}&top=${top}`;
    const res = await proxy(url, { method: "GET" });
    setLoading(false);
    if (res.ok) {
      const b = res.body as { items: GrowthBoardRow[]; days: number; top: number };
      setItems(b.items);
      router.push(`/dashboard/growth?days=${days}&top=${top}`);
    } else {
      toast.error(`Failed to load: ${res.status}`);
    }
  }

  async function sendReport() {
    if (!canWrite) return;
    const topic = topicId.trim() === "" ? null : Number(topicId.trim());
    if (topicId.trim() !== "" && !Number.isFinite(topic)) {
      toast.error("Topic id must be a number");
      return;
    }
    setBusy(true);
    const res = await proxy("/api/growth/report", {
      method: "POST",
      body: { topicId: topic },
    });
    setBusy(false);
    if (res.ok) {
      const b = res.body as { jobId?: string };
      toast.success(b.jobId ? `Enqueued (job ${b.jobId})` : "Growth report enqueued");
    } else {
      const b = res.body as { error?: string } | null;
      toast.error(b?.error ?? `Error ${res.status}`);
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Window</label>
              <div className="flex items-center gap-1">
                {DAY_OPTIONS.map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={days === d ? "default" : "outline"}
                    onClick={() => setDays(d)}
                    className="h-8 text-xs"
                  >
                    {d === 1 ? "24h" : `${d}d`}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Top N</label>
              <Input
                type="number"
                min={5}
                max={50}
                value={top}
                onChange={(e) => setTop(Math.min(50, Math.max(5, parseInt(e.target.value) || 20)))}
                className="w-20 h-8 text-xs"
              />
            </div>

            <Button size="sm" onClick={() => void loadGrowth()} disabled={loading} className="h-8">
              {loading ? <Loader2 className="size-3 animate-spin" /> : "Load"}
            </Button>

            {canWrite ? (
              <>
                <div className="flex-1" />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Telegram topic</label>
                  <TopicPicker
                    value={topicId}
                    onChange={setTopicId}
                    emptyLabel="Default topic"
                    compact
                    showMeta={false}
                    disabled={busy}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void sendReport()}
                  disabled={busy || items.length === 0}
                  className="h-8"
                >
                  {busy ? <Loader2 className="size-3 animate-spin" /> : "Send report"}
                </Button>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="size-4" />
            Top growers · {days}d window · {items.length} projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No growth data yet"
              description="Run the Early Monitor poller to collect metric snapshots."
            />
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-12 gap-4 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                <div className="col-span-1">#</div>
                <div className="col-span-4">Account</div>
                <div className="col-span-2 text-right">Followers</div>
                <div className="col-span-3 text-right">Growth</div>
                <div className="col-span-2 text-right">Change%</div>
              </div>
              {items.map((g, i) => (
                <div
                  key={g.accountId}
                  className="grid grid-cols-12 gap-4 px-3 py-2.5 rounded-md hover:bg-muted/50 items-center text-sm"
                >
                  <div className="col-span-1 text-muted-foreground tabular-nums text-xs">
                    {i + 1}
                  </div>
                  <div className="col-span-4">
                    <a
                      href={`https://x.com/${g.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      @{g.username}
                    </a>
                    <div className="text-[10px] text-muted-foreground">{g.huntStage}</div>
                  </div>
                  <div className="col-span-2 text-right tabular-nums">
                    {fmtNum(g.followersNow)}
                  </div>
                  <div className="col-span-3 text-right">
                    <span className={`tabular-nums font-medium ${g.absGain > 0 ? "text-emerald-500" : g.absGain < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                      {g.absGain > 0 ? "+" : ""}{fmtNum(g.absGain)}
                    </span>
                  </div>
                  <div className="col-span-2 text-right tabular-nums text-muted-foreground">
                    {g.pctGain != null ? `${g.pctGain > 0 ? "+" : ""}${g.pctGain.toFixed(1)}%` : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
