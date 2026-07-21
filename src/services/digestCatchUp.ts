// Digest delivery markers + catch-up on process start.
//
// Daily seed digest: cron 09:00 UTC
// Early-project digest: cron 09:00 & 21:00 UTC
//
// If the API was down across a slot, the scheduled job is skipped silently.
// On boot we compare last-sent markers and fire missed digests once.

import { getConfig, setConfig } from "./appConfig.js";

export const DIGEST_MARKERS = {
  dailyLastSentAt: "digest.daily.lastSentAt",
  earlyLastSentAt: "digest.early.lastSentAt",
} as const;

/** Record successful daily seed digest delivery (ISO string). */
export async function markDailyDigestSent(at: Date = new Date()): Promise<void> {
  await setConfig(DIGEST_MARKERS.dailyLastSentAt, at.toISOString());
}

/** Record successful early-project digest delivery (ISO string). */
export async function markEarlyDigestSent(at: Date = new Date()): Promise<void> {
  await setConfig(DIGEST_MARKERS.earlyLastSentAt, at.toISOString());
}

function parseIso(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Most recent scheduled UTC slot at or before `now` for hours [9] or [9,21]. */
function lastSlotAtOrBefore(now: Date, hoursUtc: number[]): Date {
  const sorted = [...hoursUtc].sort((a, b) => a - b);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const h = now.getUTCHours();

  // Today: latest hour that already passed (or equals current hour if minute>0 — treat hour as start).
  for (let i = sorted.length - 1; i >= 0; i--) {
    const hour = sorted[i]!;
    if (h > hour || (h === hour && (now.getUTCMinutes() > 0 || now.getUTCSeconds() > 0))) {
      return new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
    }
    // Exactly on the hour (minute=0): still count as "due" if we haven't sent for this slot.
    if (h === hour) {
      return new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
    }
  }

  // Before first slot today → yesterday's last slot
  const lastHour = sorted[sorted.length - 1]!;
  const yesterday = new Date(Date.UTC(y, m, d, lastHour, 0, 0, 0));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday;
}

/**
 * Catch up digests missed while the process was down.
 * Safe to call on every boot; no-ops when markers are current.
 */
export async function catchUpMissedDigests(): Promise<{
  daily: "sent" | "skipped" | "error";
  early: "sent" | "skipped" | "error";
}> {
  const result = {
    daily: "skipped" as "sent" | "skipped" | "error",
    early: "skipped" as "sent" | "skipped" | "error",
  };

  const now = new Date();

  // ── Daily seed digest (09:00 UTC) ──
  try {
    const lastDailyRaw = await getConfig<string | null>(
      DIGEST_MARKERS.dailyLastSentAt,
      null,
    );
    const lastDaily = parseIso(
      typeof lastDailyRaw === "string" ? lastDailyRaw : null,
    );
    const dueDaily = lastSlotAtOrBefore(now, [9]);

    // First boot: no marker yet → set baseline without sending (avoid Telegram flood).
    if (!lastDaily) {
      await markDailyDigestSent(now);
      console.log("[digest-catchup] daily: baseline marker set (no prior send)");
    } else if (lastDaily.getTime() < dueDaily.getTime()) {
      console.log(
        `[digest-catchup] daily missed (last=${lastDaily.toISOString()}, due=${dueDaily.toISOString()}) — sending`,
      );
      const { sendDailyDigestMessage } = await import(
        "../Tools/following_Track/track.js"
      );
      await sendDailyDigestMessage();
      const after = parseIso(
        (await getConfig<string | null>(DIGEST_MARKERS.dailyLastSentAt, null)) as
          | string
          | null,
      );
      if (!after || after.getTime() < dueDaily.getTime()) {
        await markDailyDigestSent(now);
      }
      result.daily = "sent";
    }
  } catch (err) {
    result.daily = "error";
    console.error("[digest-catchup] daily failed:", err);
  }

  // ── Early-project digest (09:00 & 21:00 UTC) ──
  try {
    const lastEarlyRaw = await getConfig<string | null>(
      DIGEST_MARKERS.earlyLastSentAt,
      null,
    );
    const lastEarly = parseIso(
      typeof lastEarlyRaw === "string" ? lastEarlyRaw : null,
    );
    const dueEarly = lastSlotAtOrBefore(now, [9, 21]);

    if (!lastEarly) {
      await markEarlyDigestSent(now);
      console.log("[digest-catchup] early: baseline marker set (no prior send)");
    } else if (lastEarly.getTime() < dueEarly.getTime()) {
      console.log(
        `[digest-catchup] early missed (last=${lastEarly.toISOString()}, due=${dueEarly.toISOString()}) — sending`,
      );
      const { sendEarlyProjectDigest } = await import("./earlyDigest.js");
      await sendEarlyProjectDigest();
      const after = parseIso(
        (await getConfig<string | null>(DIGEST_MARKERS.earlyLastSentAt, null)) as
          | string
          | null,
      );
      if (!after || after.getTime() < dueEarly.getTime()) {
        await markEarlyDigestSent(now);
      }
      result.early = "sent";
    }
  } catch (err) {
    result.early = "error";
    console.error("[digest-catchup] early failed:", err);
  }

  return result;
}
