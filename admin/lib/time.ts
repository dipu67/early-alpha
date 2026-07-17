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
