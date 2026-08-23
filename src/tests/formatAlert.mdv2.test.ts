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
  formatWatchingAlert,
} from "../services/formatAlert.js";

/** Bare MarkdownV2 specials that must not appear unescaped outside intentional markup. */
function hasBareTildeOutsideEscape(text: string): boolean {
  // Allow \~ only
  return /(?<!\\)~/.test(text);
}

/**
 * Every MarkdownV2 special left bare after intentional markup is removed —
 * exactly what Telegram 400s on ("can't parse entities").
 */
function bareSpecialsOutsideMarkup(text: string): string[] {
  const stripped = text
    .replace(/\[[^\]]*\]\((?:\\.|[^)\\])*\)/g, "") // [label](url) links
    .replace(/`[^`]*`/g, "") // `code` spans
    .replace(/\\[\s\S]/g, "") // escaped pairs
    .replace(/\*/g, ""); // *bold* markers
  return [...new Set(stripped.match(/[_[\]()~`>#+\-=|{}.!\\]/g) ?? [])];
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

  // Regression: the watching poller shipped an unescaped body with a raw HTML
  // anchor, so every send died with
  // "can't parse entities: Character '(' is reserved" and the watermark never
  // advanced — no watching alert ever arrived.
  it("formatWatchingAlert escapes MarkdownV2 specials and uses a markdown link", () => {
    const { text } = formatWatchingAlert({
      accountId: "1",
      username: "ord_9882",
      name: "Ord (Alpha)",
      text: "33 Forms spots up for grabs! To enter: - repost - tag 2 friends #alpha ~soon (wl)",
      tweetId: "2091231379501580628",
      followersCount: 1500,
      tweetCount: 340,
      tags: ["nft"],
    });

    // The exact characters Telegram rejected.
    expect(text).toContain("Ord \\(Alpha\\)");
    expect(text).toContain("ord\\_9882");
    expect(text).toContain("\\- repost");
    expect(text).toContain("grabs\\!");
    expect(text).toContain("\\#alpha");
    expect(text).toContain("1\\.5K followers");
    expect(hasBareTildeOutsideEscape(text)).toBe(false);

    // MarkdownV2 link, not an HTML anchor (HTML renders as literal text here).
    expect(text).not.toContain("<a href");
    expect(text).toContain(
      "[View post](https://x.com/ord_9882/status/2091231379501580628)",
    );

    // No bare MarkdownV2 special survives outside intentional markup.
    expect(bareSpecialsOutsideMarkup(text)).toEqual([]);
  });

  it("formatWatchingAlert falls back to the handle when name is empty", () => {
    const { text, user } = formatWatchingAlert({
      accountId: "1",
      username: "lastbuyers",
      name: "",
      text: "gm",
      tweetId: "5",
      followersCount: 0,
      tweetCount: 0,
    });
    // `**` would be an unmatched bold entity and Telegram would 400.
    expect(text).not.toContain("**");
    expect(text).toContain("*lastbuyers*");
    expect(user.name).toBe("lastbuyers");
  });

  it("formatWatchingAlert switches header + signal line on matched signals", () => {
    const base = {
      accountId: "1",
      username: "ord_9882",
      name: "Ord",
      text: "Mint is live now",
      tweetId: "7",
      followersCount: 10,
      tweetCount: 10,
    };

    const row = formatWatchingAlert(base);
    expect(row.text).toContain("👀 *Watching · new post*");
    expect(row.text).not.toContain("Watching · signal");

    const signal = formatWatchingAlert({ ...base, signals: ["mint live", "stage:public"] });
    expect(signal.text).toContain("🚨 *Watching · signal*");
    expect(signal.text).not.toContain("Watching · new post");
    expect(signal.text).toContain("mint live · stage:public");
    // Signal labels are user-supplied strings and must be escaped like any other.
    expect(bareSpecialsOutsideMarkup(signal.text)).toEqual([]);

    const escaped = formatWatchingAlert({ ...base, signals: ["mint_live (wl)"] });
    expect(escaped.text).toContain("mint\\_live \\(wl\\)");
    expect(bareSpecialsOutsideMarkup(escaped.text)).toEqual([]);
  });

  it("formatWatchingAlert treats an empty signal array as a plain post", () => {
    const { text } = formatWatchingAlert({
      accountId: "1",
      username: "u",
      name: "N",
      text: "gm",
      tweetId: "8",
      followersCount: 0,
      tweetCount: 0,
      signals: [],
    });
    expect(text).toContain("👀 *Watching · new post*");
  });
});
