// Heuristic: is this follow worth keeping in the project DB?
// Watchlist still *alerts* on every new follow; only early-looking accounts
// are upserted to TwitterAccount / AlertLog.

import type { UserData } from "../TwitterClient/types.js";

/** Max followers for an "early" project account. */
export const EARLY_MAX_FOLLOWERS = 50_000;
/** Max following count — mass-follow accounts are not projects. */
export const EARLY_MAX_FOLLOWING = 50_000;
/** Max account age (ms) — older than 1 year is not early. */
export const EARLY_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * True when the account looks early enough to store (digest, hunter, lists).
 * False for established accounts (age > 1y, followers ≥ 50k, following ≥ 50k).
 * Missing stats: treat as storable so we don't drop incomplete API payloads.
 */
export function isEarlyProjectCandidate(user: UserData): boolean {
  const followers = user.followersCount;
  if (followers != null && followers >= EARLY_MAX_FOLLOWERS) return false;

  const following = user.followingCount;
  if (following != null && following >= EARLY_MAX_FOLLOWING) return false;

  if (user.createdAt) {
    const created = new Date(user.createdAt).getTime();
    if (Number.isFinite(created) && Date.now() - created > EARLY_MAX_AGE_MS) {
      return false;
    }
  }

  return true;
}
