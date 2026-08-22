"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Play, Pause, Bell, BellOff } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { proxy } from "@/lib/client";

interface SchedulerItem {
  key: string;
  label: string;
  paused: boolean;
  cron: string | null;
  every: number | null;
  nextRun: string | null;
}

interface WatchingConfig {
  signalEnabled: boolean;
  rowEnabled: boolean;
  intervalMs: number;
}

export function WatchingControls({ scheduler, config }: { scheduler: SchedulerItem | undefined; config: WatchingConfig | null }) {
  const [interval, setInterval] = useState(config?.intervalMs ? String(config.intervalMs) : "3600000");
  const [signalEnabled, setSignalEnabled] = useState(config?.signalEnabled ?? true);
  const [rowEnabled, setRowEnabled] = useState(config?.rowEnabled ?? true);

  async function saveConfig(updates: Partial<WatchingConfig>) {
    await proxy("/api/watching/config", {
      method: "PATCH",
      body: updates,
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <Bell className="size-4 text-primary" />
        Watching Controls
      </h3>

      {/* Top row: Interval + Toggles */}
      <div className="flex flex-wrap gap-4 items-start">
        {/* Interval Control */}
        <div className="flex-1 min-w-[200px] space-y-2">
          <Label className="text-xs text-muted-foreground">Poll Interval</Label>
          <div className="flex gap-2">
            <Select value={interval} onValueChange={(v) => setInterval(v)}>
              <SelectTrigger className="h-8 flex-1">
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="300000">5 minutes</SelectItem>
                <SelectItem value="900000">15 minutes</SelectItem>
                <SelectItem value="1800000">30 minutes</SelectItem>
                <SelectItem value="3600000">1 hour</SelectItem>
                <SelectItem value="7200000">2 hours</SelectItem>
                <SelectItem value="14400000">4 hours</SelectItem>
                <SelectItem value="43200000">12 hours</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2"
              title="Trigger poll now"
              onClick={async () => {
                await proxy("/api/watching/poll", { method: "POST" });
                toast.success("Poll enqueued");
              }}
            >
              <RefreshCw className="size-3" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {scheduler?.cron ? `Cron: ${scheduler.cron}` : `Every: ${scheduler?.every ? Math.round(scheduler.every / 60000) + "m" : "1h"}`}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs w-full"
            onClick={async () => {
              await saveConfig({ intervalMs: Number(interval) });
              toast.success("Interval updated");
            }}
          >
            Save Interval
          </Button>
        </div>

        {/* Toggles */}
        <div className="flex gap-6 items-center">
          {/* Signal Alerts Toggle */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground cursor-pointer" htmlFor="signal-toggle">
              Signal Alerts
            </Label>
            <Switch
              id="signal-toggle"
              checked={signalEnabled}
              onCheckedChange={async (checked) => {
                setSignalEnabled(checked);
                await saveConfig({ signalEnabled: checked });
                toast.success(checked ? "Signal alerts enabled" : "Signal alerts disabled");
              }}
            />
            <span className={`text-xs font-medium ${signalEnabled ? "text-green-600" : "text-muted-foreground"}`}>
              {signalEnabled ? "On" : "Off"}
            </span>
          </div>

          {/* Row Updates Toggle */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground cursor-pointer" htmlFor="row-toggle">
              Row Updates
            </Label>
            <Switch
              id="row-toggle"
              checked={rowEnabled}
              onCheckedChange={async (checked) => {
                setRowEnabled(checked);
                await saveConfig({ rowEnabled: checked });
                toast.success(checked ? "Row updates enabled" : "Row updates disabled");
              }}
            />
            <span className={`text-xs font-medium ${rowEnabled ? "text-green-600" : "text-muted-foreground"}`}>
              {rowEnabled ? "On" : "Off"}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom row: Queue Status */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Queue Status</Label>
            {scheduler ? (
              <>
                <Badge variant={scheduler.paused ? "secondary" : "default"} className="text-xs">
                  {scheduler.paused ? "Paused" : "Running"}
                </Badge>
                {scheduler.nextRun && (
                  <Badge variant="outline" className="text-xs">
                    Next run
                  </Badge>
                )}
              </>
            ) : (
              <Badge variant="secondary" className="text-xs">No scheduler</Badge>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-3"
              onClick={async () => {
                if (!scheduler) return;
                await proxy(`/api/queues/${scheduler.key}/pause`, { method: "POST" });
                toast.success("Scheduler paused");
                window.location.reload();
              }}
              disabled={!scheduler?.paused}
            >
              <Pause className="size-3 mr-1" /> Pause
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-3"
              onClick={async () => {
                if (!scheduler) return;
                await proxy(`/api/queues/${scheduler.key}/resume`, { method: "POST" });
                toast.success("Scheduler resumed");
                window.location.reload();
              }}
              disabled={scheduler?.paused ?? true}
            >
              <Play className="size-3 mr-1" /> Resume
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
