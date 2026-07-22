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

  it("escapes MarkdownV2 specials in baseline footer (no bare ~ or _ italic trap)", () => {
    // Regression: `_Baseline: snapshot ~7d…_` made Telegram 400 with
    // "Can't find end of Italic entity" because ~ opens strikethrough.
    const text = formatGrowthReport({
      days: 7,
      rows: [
        {
          username: "user_name",
          name: "Name_With_Underscores",
          tags: ["layer_2", "defi"],
          followersNow: 12_400,
          followersBefore: 1_000,
          absGain: 11_400,
          pctGain: 1140,
          huntStage: "soft",
        },
      ],
    });

    // Username underscores escaped in display
    expect(text).toContain("user\\_name");
    // Tags with underscores escaped
    expect(text).toContain("layer\\_2");
    // Footer: ~ and - escaped; no wrapping _…_ italic
    expect(text).toMatch(/Baseline: snapshot \\~7d ago or detect\\-time followers/);
    expect(text).not.toMatch(/^_Baseline/m);
    expect(text).not.toMatch(/snapshot ~\d/);
  });
});
