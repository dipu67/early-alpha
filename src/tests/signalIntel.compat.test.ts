import { describe, expect, it } from "vitest";
import {
  evaluateSignalImportance,
  extractNftFields,
  shouldPersistSignal,
} from "../services/signalIntel.js";

/** Compat: extractNftFields alias still works. */
describe("signalIntel NFT compat", () => {
  it("extractNftFields still exported", () => {
    const f = extractNftFields("Mint Date: TBA\nSupply: 1000");
    expect(f.hasTba).toBe(true);
  });

  it("mint live scores", () => {
    const imp = evaluateSignalImportance({
      text: "MINT IS LIVE https://opensea.io/collection/x",
      signals: ["mint is live"],
      tagSlug: "nft",
      isOfficialAuthor: true,
    });
    expect(shouldPersistSignal(imp)).toBe(true);
  });
});
