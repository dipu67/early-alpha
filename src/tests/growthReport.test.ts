import { describe, expect, it } from "vitest";
import { formatGrowthReport } from "../services/formatAlert.js";

describe("formatGrowthReport", () => {
  it("renders ranked growers with gains", () => {
    const text = formatGrowthReport({
      days: 7,
      rows: [
        {
          username: "earlyalpha",
          name: "Early Alpha",
          tags: ["nft", "unknown"],
          followersNow: 5000,
          followersBefore: 240,
          absGain: 4760,
          pctGain: 1983.3,
          huntStage: "hot",
        },
      ],
    });
    expect(text).toContain("Top growing");
    expect(text).toContain("earlyalpha");
    expect(text).toMatch(/4\\.8K|4\.8K|4760/);
    expect(text).toContain("240");
  });
});
