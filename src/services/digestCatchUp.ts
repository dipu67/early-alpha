// digestCatchUp — on boot, check if we missed a scheduled digest and replay it.
// Safe to call every start; no-ops when markers are current.
import { getConfig, setConfig, CONFIG_KEYS } from "./appConfig.js";
// Daily digest imported lazily

/** Config keys for digest delivery markers. */
const DIGEST_MARKERS = {
  dailyLastSentAt: "digest.daily.lastSentAt",
} as const;

/** Record successful daily seed digest delivery (ISO string). */
export async function markDailyDigestSent(at: Date = new Date()): Promise<void> {
  await setConfig(DIGEST_MARKERS.dailyLastSentAt, at.toISOString());
}

function parseIso(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Catch up digests missed while the process was down.
 * Safe to call on every boot; no-ops when markers are current.
 */
export async function catchUpMissedDigests(): Promise<{
  daily: "sent" | "skipped" | "error";
}> {
  const result = { daily: "skipped" as "sent" | "skipped" | "error" };
  const now = new Date();

  // ── Daily seed digest (09:00 UTC) ──
  try {
    const lastDailyRaw = await getConfig<string | null>(
      DIGEST_MARKERS.dailyLastSentAt,
      null,
    );
    const lastDaily = parseIso(lastDailyRaw);
    const dueDaily = lastSlotAtOrBefore(now, [9]);

    if (!lastDaily) {
      await markDailyDigestSent(now);
    } else if (lastDaily.getTime() < dueDaily.getTime()) {
      const after = parseIso(
        (await getConfig<string | null>(DIGEST_MARKERS.dailyLastSentAt, null)) as
          | string
          | null,
      );
      if (!after || after.getTime() < dueDaily.getTime()) {
        const { sendDailyDigestMessage } = await import("../Tools/following_Track/track.js");
        await sendDailyDigestMessage();
        await markDailyDigestSent(now);
      }
      result.daily = "sent";
    }
  } catch (err) {
    result.daily = "error";
    console.error("[digest-catchup] daily failed:", err);
  }

  return result;
}

/** Most recent scheduled UTC slot at or before `now` for given hours. */
function lastSlotAtOrBefore(now: Date, hoursUtc: number[]): Date {
  const sorted = [...hoursUtc].sort((a, b) => a - b);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const h = now.getUTCHours();

  for (let i = sorted.length - 1; i >= 0; i--) {
    const hour = sorted[i]!;
    if (h > hour || (h === hour && (now.getUTCMinutes() > 0 || now.getUTCSeconds() > 0))) {
      return new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
    }
    if (h === hour) {
      return new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
    }
  }

  const lastHour = sorted[sorted.length - 1]!;
  const yesterday = new Date(Date.UTC(y, m, d, lastHour, 0, 0, 0));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday;
}
