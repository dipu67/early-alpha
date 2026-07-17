"use client";

import { useEffect, useState } from "react";
import {
  fmtLocalDate,
  fmtLocalDateFull,
  getLocalTimeZone,
  type FmtLocalOpts,
} from "@/lib/time";
import { cn } from "@/lib/cn";

type Props = {
  /** ISO string, epoch ms, or Date-serializable value from the API. */
  iso: string | number | Date | null | undefined;
  className?: string;
  /** Formatting options (local zone by default). */
  opts?: FmtLocalOpts;
  /** Show a richer absolute time in the title tooltip. */
  title?: boolean;
};

/**
 * Renders a timestamp in the browser's local timezone.
 * Client-only so SSR (often UTC) never lies about the zone.
 */
export function LocalTime({ iso, className, opts, title = true }: Props) {
  // null on first paint → fill after mount to avoid server/client mismatch
  const [label, setLabel] = useState<string | null>(null);
  const [full, setFull] = useState<string>("");

  useEffect(() => {
    setLabel(fmtLocalDate(iso, opts));
    setFull(fmtLocalDateFull(iso));
  }, [iso, opts?.year, opts?.seconds, opts?.zone, opts?.dateOnly]);

  if (iso == null || iso === "") {
    return <span className={className}>—</span>;
  }

  // Stable placeholder length while hydrating (avoids layout jump)
  const text = label ?? "…";

  return (
    <time
      dateTime={typeof iso === "string" ? iso : iso instanceof Date ? iso.toISOString() : undefined}
      title={title && full ? `${full} (${getLocalTimeZone()})` : undefined}
      className={cn("tabular-nums", className)}
      suppressHydrationWarning
    >
      {text}
    </time>
  );
}

/** Live clock + zone chip for the top bar. */
export function LocalTimeZoneBadge({ className }: { className?: string }) {
  const [now, setNow] = useState<string>("");
  const [zone, setZone] = useState<string>("");

  useEffect(() => {
    function tick() {
      const d = new Date();
      setNow(
        d.toLocaleString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }),
      );
      setZone(getLocalTimeZone());
    }
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!now) {
    return (
      <span
        className={cn(
          "hidden items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex",
          className,
        )}
      >
        …
      </span>
    );
  }

  return (
    <span
      title={`All dashboard times use your local zone: ${zone}`}
      className={cn(
        "hidden items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] tabular-nums text-muted-foreground sm:inline-flex",
        className,
      )}
    >
      <span className="font-medium text-foreground/80">{now}</span>
      <span className="text-[10px] opacity-70">{zone}</span>
    </span>
  );
}
