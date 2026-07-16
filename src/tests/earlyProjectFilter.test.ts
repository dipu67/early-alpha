import { describe, it, expect } from "vitest";
import {
  isEarlyProjectCandidate,
  EARLY_MAX_FOLLOWERS,
  EARLY_MAX_FOLLOWING,
} from "../services/earlyProjectFilter.js";
import type { UserData } from "../TwitterClient/types.js";

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    id: "123",
    username: "earlyproj",
    name: "Early Project",
    description: "building something new",
    followersCount: 500,
    followingCount: 100,
    tweetCount: 50,
    likeCount: 10,
    isBlueVerified: false,
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("isEarlyProjectCandidate", () => {
  it("accepts a young low-follower account", () => {
    expect(isEarlyProjectCandidate(makeUser())).toBe(true);
  });

  it("rejects accounts with ≥ 50k followers", () => {
    expect(
      isEarlyProjectCandidate(makeUser({ followersCount: EARLY_MAX_FOLLOWERS })),
    ).toBe(false);
    expect(
      isEarlyProjectCandidate(makeUser({ followersCount: 80_000 })),
    ).toBe(false);
  });

  it("rejects accounts following ≥ 50k", () => {
    expect(
      isEarlyProjectCandidate(makeUser({ followingCount: EARLY_MAX_FOLLOWING })),
    ).toBe(false);
    expect(
      isEarlyProjectCandidate(makeUser({ followingCount: 100_000 })),
    ).toBe(false);
  });

  it("rejects accounts older than 1 year", () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(isEarlyProjectCandidate(makeUser({ createdAt: old }))).toBe(false);
  });

  it("accepts accounts just under 1 year old", () => {
    const almostYear = new Date(
      Date.now() - 360 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(isEarlyProjectCandidate(makeUser({ createdAt: almostYear }))).toBe(
      true,
    );
  });

  it("accepts when stats are missing (incomplete payload)", () => {
    const sparse = makeUser();
    delete (sparse as unknown as Record<string, unknown>).followersCount;
    delete (sparse as unknown as Record<string, unknown>).followingCount;
    delete (sparse as unknown as Record<string, unknown>).createdAt;
    expect(isEarlyProjectCandidate(sparse)).toBe(true);
  });
});
