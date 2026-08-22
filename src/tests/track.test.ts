import { describe, it, expect } from "vitest";
import { categorizeFromBio, passesEarlyStageFilter } from "../Tools/following_Track/track.js";
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

describe("categorizeFromBio", () => {
  it("returns empty for null/undefined bio", () => {
    expect(categorizeFromBio(null)).toEqual([]);
    expect(categorizeFromBio(undefined)).toEqual([]);
    expect(categorizeFromBio("")).toEqual([]);
  });

  it("detects DeFi keywords", () => {
    expect(categorizeFromBio("Building a defi protocol")).toContain("DeFi");
    expect(categorizeFromBio("Best DEX aggregator")).toContain("DeFi");
    expect(categorizeFromBio("Yield farming maximalist")).toContain("DeFi");
  });

  it("detects NFT keywords", () => {
    expect(categorizeFromBio("NFT collector and artist")).toContain("NFT");
    expect(categorizeFromBio("PFP project on ETH")).toContain("NFT");
  });

  it("detects L2 keywords", () => {
    expect(categorizeFromBio("Building on Arbitrum")).toContain("L2");
    expect(categorizeFromBio("ZK rollup infrastructure")).toContain("L2");
  });

  it("detects GameFi keywords", () => {
    expect(categorizeFromBio("Web3 game studio")).toContain("GameFi");
    expect(categorizeFromBio("Play-to-earn revolution")).toContain("GameFi");
  });

  it("detects multiple categories", () => {
    const cats = categorizeFromBio("NFT marketplace with DeFi lending");
    expect(cats).toContain("DeFi");
    expect(cats).toContain("NFT");
  });

  it("uses word boundaries", () => {
    expect(categorizeFromBio("undefined")).toEqual([]);
    expect(categorizeFromBio("fundamental analysis")).toEqual([]);
  });
});

describe("passesEarlyStageFilter", () => {
  it("passes for a valid early-stage account", () => {
    expect(passesEarlyStageFilter(makeUser())).toBe(true);
  });

  it("rejects accounts with >= 10K followers", () => {
    expect(passesEarlyStageFilter(makeUser({ followersCount: 10_000 }))).toBe(false);
    expect(passesEarlyStageFilter(makeUser({ followersCount: 50_000 }))).toBe(false);
  });

  it("rejects accounts with 0 or missing followers", () => {
    expect(passesEarlyStageFilter(makeUser({ followersCount: 0 }))).toBe(false);
    const noFollowers = makeUser();
    delete (noFollowers as unknown as Record<string, unknown>).followersCount;
    expect(passesEarlyStageFilter(noFollowers)).toBe(false);
  });

  it("rejects accounts with airdrop/giveaway in bio", () => {
    expect(passesEarlyStageFilter(makeUser({ description: "DeFi airdrop hunter" }))).toBe(false);
    expect(passesEarlyStageFilter(makeUser({ description: "Free giveaway DeFi" }))).toBe(false);
  });

  it("rejects exchange accounts", () => {
    expect(passesEarlyStageFilter(makeUser({ description: "Official Binance DeFi" }))).toBe(false);
    expect(passesEarlyStageFilter(makeUser({ description: "Coinbase listing DeFi" }))).toBe(false);
  });

  it("rejects accounts with no category keywords", () => {
    expect(passesEarlyStageFilter(makeUser({ description: "Just a regular person" }))).toBe(false);
  });

  it("rejects old accounts (> 6 months)", () => {
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(passesEarlyStageFilter(makeUser({ createdAt: oldDate }))).toBe(false);
  });

  it("rejects accounts without createdAt (can't determine age)", () => {
    const noDate = makeUser();
    delete (noDate as unknown as Record<string, unknown>).createdAt;
    expect(passesEarlyStageFilter(noDate)).toBe(false);
  });
});
