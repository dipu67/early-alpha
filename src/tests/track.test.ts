import { describe, it, expect } from "vitest";
import { passesEarlyStageFilter } from "../Tools/following_Track/track.js";
import type { UserData } from "../TwitterClient/types.js";

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    id: "123",
    username: "testuser",
    name: "Test User",
    description: "DeFi protocol building the future",
    followersCount: 500,
    followingCount: 100,
    tweetCount: 50,
    likeCount: 10,
    isBlueVerified: false,
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("passesEarlyStageFilter", () => {
  it("passes for a valid early-stage account", async () => {
    expect(await passesEarlyStageFilter(makeUser())).toBe(true);
  });

  it("rejects accounts with >= 10K followers", async () => {
    expect(await passesEarlyStageFilter(makeUser({ followersCount: 10_000 }))).toBe(false);
    expect(await passesEarlyStageFilter(makeUser({ followersCount: 50_000 }))).toBe(false);
  });

  it("rejects accounts with 0 or missing followers", async () => {
    expect(await passesEarlyStageFilter(makeUser({ followersCount: 0 }))).toBe(false);
    const noFollowers = makeUser();
    delete (noFollowers as unknown as Record<string, unknown>).followersCount;
    expect(await passesEarlyStageFilter(noFollowers)).toBe(false);
  });

  it("rejects accounts with airdrop/giveaway in bio", async () => {
    expect(await passesEarlyStageFilter(makeUser({ description: "DeFi airdrop hunter" }))).toBe(false);
    expect(await passesEarlyStageFilter(makeUser({ description: "Free giveaway DeFi" }))).toBe(false);
  });

  it("rejects exchange accounts", async () => {
    expect(await passesEarlyStageFilter(makeUser({ description: "Official Binance DeFi" }))).toBe(false);
    expect(await passesEarlyStageFilter(makeUser({ description: "Coinbase listing DeFi" }))).toBe(false);
  });

  it("rejects accounts with no tag keywords", async () => {
    expect(await passesEarlyStageFilter(makeUser({ description: "Just a regular person" }))).toBe(false);
  });

  it("rejects old accounts (> 6 months)", async () => {
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(await passesEarlyStageFilter(makeUser({ createdAt: oldDate }))).toBe(false);
  });

  it("rejects accounts without createdAt (can't determine age)", async () => {
    const noDate = makeUser();
    delete (noDate as unknown as Record<string, unknown>).createdAt;
    expect(await passesEarlyStageFilter(noDate)).toBe(false);
  });
});
