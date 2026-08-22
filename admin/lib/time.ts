/**
 * Local-timezone date helpers for the admin UI.
 *
 * Always prefer these over raw toISOString() for display — API timestamps are
 * UTC, but operators should see their machine's local time + zone label.
 */

/** IANA zone for the current environment (browser or Node). */
export function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

/** Short zone label, e.g. "BST", "GMT+6", "PDT". */
export function getLocalTimeZoneShort(at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "short",
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? getLocalTimeZone();
  } catch {
    return getLocalTimeZone();
  }
}

export type FmtLocalOpts = {
  /** Include year (default false for recent-looking UI). */
  year?: boolean;
  /** Include seconds. */
  seconds?: boolean;
  /** Append short timezone name (default true). */
  zone?: boolean;
  /** Date only — no time. */
  dateOnly?: boolean;
};

/**
 * Format an ISO / parseable timestamp in the local timezone.
 * Returns "—" for null/invalid.
 */
export function fmtLocalDate(
  iso: string | number | Date | null | undefined,
  opts: FmtLocalOpts = {},
): string {
  if (iso == null || iso === "") return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const showZone = opts.zone !== false && !opts.dateOnly;

  if (opts.dateOnly) {
    return d.toLocaleDateString(undefined, {
      year: opts.year === false ? undefined : "numeric",
      month: "short",
      day: "numeric",
    });
  }

  return d.toLocaleString(undefined, {
    year: opts.year ? "numeric" : undefined,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: opts.seconds ? "2-digit" : undefined,
    timeZoneName: showZone ? "short" : undefined,
  });
}

/**
 * Full local datetime with year + zone — for tooltips / detail rows.
 */
export function fmtLocalDateFull(
  iso: string | number | Date | null | undefined,
): string {
  return fmtLocalDate(iso, { year: true, seconds: true, zone: true });
}

/**
 * Relative time ago, e.g. "2 min ago", "3 hours ago", "5 days ago".
 */
export function timeAgo(
  iso: string | number | Date | null | undefined,
): string {
  if (iso == null || iso === "") return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return diffSec === 0 ? "just now" : `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin > 1 ? "s" : ""} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr > 1 ? "s" : ""} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo} month${diffMo > 1 ? "s" : ""} ago`;
  return `${Math.floor(diffMo / 12)} year${Math.floor(diffMo / 12) > 1 ? "s" : ""} ago`;
}
