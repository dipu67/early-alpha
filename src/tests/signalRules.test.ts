import { describe, expect, it } from "vitest";
import {
  structuralFallbackSignals,
  normalizeTagSlugs,
} from "../services/signalRules.js";

describe("normalizeTagSlugs", () => {
  it("drops noise tags and dedupes", () => {
    expect(normalizeTagSlugs(["nft", "unknown", "alpha", "NFT", "defi", ""])).toEqual([
      "nft",
      "defi",
    ]);
  });

  it("accepts single string", () => {
    expect(normalizeTagSlugs("l1")).toEqual(["l1"]);
  });
});

describe("structuralFallbackSignals", () => {
  it("catches mint + opensea link without lexicon phrase", () => {
    const labels = structuralFallbackSignals(
      "We are so excited!! Mint opens soon https://opensea.io/collection/foo",
    );
    expect(labels).toContain("mint link");
  });

  it("catches mint schedule language", () => {
    const labels = structuralFallbackSignals(
      "Official mint March 15 — mark your calendars",
    );
    expect(
      labels.some((l) => l.includes("mint") || l.includes("schedule")),
    ).toBe(true);
  });

  it("catches WL form link", () => {
    const labels = structuralFallbackSignals(
      "Whitelist form is open https://premint.xyz/foo apply for wl",
    );
    expect(labels).toContain("wl form link");
  });

  it("ignores unrelated tweets", () => {
    expect(structuralFallbackSignals("gm frens have a great day")).toEqual([]);
  });
});
