import { describe, expect, it } from "vitest";
import {
  extractSignalFields,
  evaluateSignalImportance,
  stagesFromLabels,
  shouldPersistSignal,
} from "../services/signalIntel.js";

describe("extractSignalFields multi-vertical", () => {
  it("extracts L1 mainnet card fields", () => {
    const text = `
Mainnet is live.
Chain ID: 1088
RPC: https://rpc.example.com
Explorer: https://scan.example.com
`;
    const f = extractSignalFields(text);
    expect(f.chainId).toBe("1088");
    expect(f.rpcUrl).toContain("rpc.example.com");
    expect(f.explorerUrl).toContain("scan.example.com");
  });

  it("extracts claim and docs links", () => {
    const text =
      "Claim is live: https://claim.example.com/airdrop\nAPI docs: https://docs.example.com/api";
    const f = extractSignalFields(text);
    expect(f.claimLinks.length + f.docsLinks.length).toBeGreaterThan(0);
  });

  it("extracts contract address and ticker", () => {
    const text = "Agent is live. CA: 0x1234567890abcdef1234567890abcdef12345678 $AGENT";
    const f = extractSignalFields(text);
    expect(f.contractAddress?.toLowerCase()).toMatch(/^0x[a-f0-9]{40}$/);
    expect(f.ticker).toBe("AGENT");
  });
});

describe("stagesFromLabels multi-vertical", () => {
  it("maps mainnet / claim / api", () => {
    expect(stagesFromLabels(["mainnet is live"])).toContain("mainnet_live");
    expect(stagesFromLabels(["claim is live"])).toContain("claim_live");
    expect(stagesFromLabels(["api is live"])).toContain("api_live");
    expect(stagesFromLabels(["agent is live"])).toContain("agent_live");
    expect(stagesFromLabels(["vault is live"])).toContain("vault_live");
  });
});

describe("evaluateSignalImportance multi-vertical", () => {
  it("scores L1 mainnet + structure as critical", () => {
    const text =
      "Mainnet is live.\nChain ID: 1088\nRPC: https://rpc.example.com\nExplorer: https://scan.example.com";
    const imp = evaluateSignalImportance({
      text,
      signals: ["mainnet is live"],
      tagSlug: "l1",
      isOfficialAuthor: true,
    });
    expect(imp.tier).toBe("critical");
    expect(imp.stages).toContain("mainnet_live");
    expect(imp.vertical).toBe("l1");
    expect(shouldPersistSignal(imp)).toBe(true);
  });

  it("scores AI API live + docs as critical", () => {
    const text =
      "Our inference API is live. Docs: https://docs.example.com/api";
    const imp = evaluateSignalImportance({
      text,
      signals: ["api is live"],
      tagSlug: "ai",
      isOfficialAuthor: true,
    });
    expect(imp.tier).toBe("critical");
    expect(imp.stages).toContain("api_live");
  });

  it("scores claim live as high priority", () => {
    const text = "Claim portal is live: https://claim.project.xyz/check";
    const imp = evaluateSignalImportance({
      text,
      signals: ["claim is live", "claim portal"],
      tagSlug: "defi",
      isOfficialAuthor: true,
    });
    expect(shouldPersistSignal(imp)).toBe(true);
    expect(imp.score).toBeGreaterThanOrEqual(40);
  });

  it("still scores NFT mint live + link as critical", () => {
    const text =
      "MINT IS LIVE.\nhttps://opensea.io/collection/foo\n2 mints per wallet";
    const imp = evaluateSignalImportance({
      text,
      signals: ["mint is live"],
      tagSlug: "nft",
      isOfficialAuthor: true,
    });
    expect(imp.tier).toBe("critical");
    expect(imp.stages).toContain("mint_live");
  });

  it("drops bare AI fluff", () => {
    const imp = evaluateSignalImportance({
      text: "Excited about the future of AI on-chain 🚀",
      signals: ["ai"],
      tagSlug: "ai",
      isOfficialAuthor: false,
    });
    expect(imp.tier).toBe("drop");
    expect(shouldPersistSignal(imp)).toBe(false);
  });

  it("soft-ranks waitlist without urgency", () => {
    const imp = evaluateSignalImportance({
      text: "Join the waitlist for early access to our AI app.",
      signals: ["waitlist is open", "join the waitlist"],
      tagSlug: "ai",
      isOfficialAuthor: true,
    });
    expect(shouldPersistSignal(imp)).toBe(true);
    expect(["soft", "standard", "critical"]).toContain(imp.tier);
  });
});
