import { describe, expect, it } from "vitest";
import {
  escapeMarkdown,
  formatChainlistAlert,
  formatConvergenceAlert,
  formatDailyDigest,
  formatEarlyRawPostAlert,
  formatGithubCommitAlert,
  formatListMonitorAlert,
  formatMonitorAlert,
  formatNumber,
  formatProfileChangeAlert,
  formatReclassifyAlert,
  formatSearchAlert,
  formatSignalAlert,
} from "../services/formatAlert.js";

/** Bare MarkdownV2 specials that must not appear unescaped outside intentional markup. */
function hasBareTildeOutsideEscape(text: string): boolean {
  // Allow \~ only
  return /(?<!\\)~/.test(text);
}

describe("escapeMarkdown", () => {
  it("escapes all Telegram MarkdownV2 specials including backslash", () => {
    const raw = "_*[]()~`>#+-=|{}.!\\";
    const out = escapeMarkdown(raw);
    expect(out).toBe(
      "\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\",
    );
  });

  it("does not double-escape formatNumber (callers escape once)", () => {
    // formatNumber is raw; escape once for plain text
    expect(formatNumber(1500)).toBe("1.5K");
    expect(escapeMarkdown(formatNumber(1500))).toBe("1\\.5K");
  });
});

describe("formatters MarkdownV2", () => {
  it("formatSignalAlert escapes bio specials and builds safe links", () => {
    const { text } = formatSignalAlert({
      accountId: "1",
      username: "user_name",
      name: "Name_Here",
      slug: "nft",
      signals: ["mint", "stage:public"],
      text: "Mint live ~now! (wl) #alpha",
      tweetId: "99",
      importance: {
        tier: "critical",
        score: 9,
        headline: "Mint_soon!",
        stages: ["public"],
        fields: {
          relative: "hours",
          relativeAmount: 2,
          rpcUrl: "https://rpc.example.com/path)",
          mintLinks: ["https://mint.example.com/a)b"],
        },
      },
    });
    expect(text).toContain("user\\_name");
    expect(text).toContain("Name\\_Here");
    expect(text).toContain("Mint\\_soon\\!");
    expect(text).toContain("in \\~2h");
    expect(hasBareTildeOutsideEscape(text)).toBe(false);
    // Link URLs escape ) 
    expect(text).toContain("https://rpc.example.com/path\\)");
    expect(text).toContain("https://mint.example.com/a\\)b");
  });

  it("formatSearchAlert / list / monitor / reclassify escape usernames", () => {
    const base = {
      username: "a_b",
      name: "N_1",
      text: "hello_world ~x",
      tweetId: "1",
    };
    expect(formatSearchAlert({ ...base, query: "q" }).text).toContain("a\\_b");
    expect(
      formatListMonitorAlert({ ...base, listId: "9" }).text,
    ).toContain("a\\_b");
    expect(
      formatMonitorAlert({
        ...base,
        accountId: "1",
        slug: "nft",
        signals: ["post"],
        alertMode: "all",
      }).text,
    ).toContain("a\\_b");
    expect(
      formatReclassifyAlert({
        accountId: "1",
        username: "a_b",
        name: "N",
        from: "unknown",
        to: ["nft"],
        tweetId: "1",
      }).text,
    ).toContain("a\\_b");
  });

  it("formatChainlistAlert and github commit use safe links/code", () => {
    const chain = formatChainlistAlert({
      chainId: "12345",
      name: "Test_Chain",
      shortName: "tc",
      nativeSymbol: "T.C",
      rpcUrl: "https://rpc.test/)",
      explorerUrl: "https://ex.test/)",
      isTestnet: false,
      rpcLive: true,
      source: "chainlist",
    });
    expect(chain.text).toContain("Test\\_Chain");
    expect(chain.text).toContain("T\\.C");
    expect(chain.text).toContain("https://ex.test/\\)");

    const gh = formatGithubCommitAlert({
      fullName: "org/repo_name",
      sha: "abcdef012345",
      message: "fix: escape_me ~now",
      htmlUrl: "https://github.com/org/repo_name/commit/abcdef)",
      filesAdded: ["src/a_b.ts"],
    });
    expect(gh.text).toContain("repo\\_name");
    expect(gh.text).toContain("escape\\_me \\~now");
    expect(gh.text).toContain("abcdef\\)");
  });

  it("formatConvergenceAlert and digest escape handles and avoid double-escape", () => {
    const conv = formatConvergenceAlert({
      targetUsername: "tgt_user",
      targetName: "Target_Name",
      targetBio: "bio_with_underscores",
      targetFollowerCount: 2500,
      targetAccountAge: "1.5yr",
      seedUsernames: ["seed_one", "seed_two"],
      categories: ["defi"],
      score: 3,
    });
    expect(conv).toContain("tgt\\_user");
    expect(conv).toContain("Target\\_Name");
    expect(conv).toContain("seed\\_one");
    expect(conv).toContain("1\\.5yr");
    // code span with raw 2.5K (dot not backslash-escaped inside code)
    expect(conv).toMatch(/`2\.5K`/);

    const digest = formatDailyDigest(
      [
        {
          seedUsername: "seed_a",
          targetUsername: "tgt_b",
          targetFollowerCount: 1500,
          targetBio: "hi_there",
        },
      ],
      new Map([
        [
          "DeFi",
          [
            {
              seedUsername: "seed_a",
              targetUsername: "tgt_b",
              targetFollowerCount: 1500,
              targetBio: "hi_there",
            },
          ],
        ],
      ]),
      "2026-03-01",
    );
    expect(digest).toContain("seed\\_a");
    expect(digest).toContain("tgt\\_b");
    expect(digest).toContain("1\\.5K");
    // must not double-escape
    expect(digest).not.toContain("1\\\\.5K");
    expect(digest).toContain("hi\\_there");
  });

  it("formatProfileChangeAlert and early raw post escape specials", () => {
    const profile = formatProfileChangeAlert({
      accountId: "1",
      username: "new_user",
      name: "New_Name",
      previousUsername: "old_user",
      bioChanged: true,
      oldBio: "a",
      newBio: "bio ~ update_now!",
      followersCount: 1200,
      tags: ["nft"],
    });
    expect(profile.text).toContain("old\\_user");
    expect(profile.text).toContain("new\\_user");
    expect(profile.text).toContain("\\~");
    expect(profile.text).toContain("update\\_now\\!");

    const raw = formatEarlyRawPostAlert({
      accountId: "1",
      username: "u_1",
      name: "N_1",
      text: "raw_post ~x",
      tweetId: "1",
      tags: ["tag_a"],
    });
    expect(raw.text).toContain("u\\_1");
    expect(raw.text).toContain("raw\\_post \\~x");
    expect(raw.text).toContain("No signal keyword matched");
  });
});
