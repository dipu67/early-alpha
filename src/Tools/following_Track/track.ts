import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma, resyncSerialSequence } from "../../db/prisma.js";
import { FxTwitterClient } from "../../fxTwitter/fxTwitterClient.js";
import type { APIUser } from "../../fxTwitter/types.js";
import type { UserData } from "../../TwitterClient/types.js";
import {
  sendTelegramAlert,
  sendTelegramPlaintext,
  isAlertEnabled,
} from "../../tg/sendAlert.js";
import {
  formatConvergenceAlert,
  type ConvergenceAlertData,
  type DigestEntry,
  formatDailyDigest,
  getAccountAge,
  formatNewFollowAlert,
} from "../../services/formatAlert.js";

// --- Category tagging ---
// Tags are now loaded from DB (project_tags table) via classifyAccount.
// No hardcoded keyword lists here — edit tags from the admin Keywords UI.

// --- Project enrichment ---

import { enrichFromBio } from "../../services/projectEnricher.js";
import { classifyAccount, DEFAULT_SLUG } from "../../services/projectTagger.js";
import { tagsToCategories } from "../../services/projectTagger.js";


/** Ensure a Project row exists for this account, created at discovery time. */
async function upsertProjectAtDiscovery(
  accountId: string,
  username: string,
  bio: string | null | undefined,
): Promise<void> {
  const { chain } = enrichFromBio(bio, username);
  const { tagsToCategories } = await import("../../services/projectTagger.js");
  const catArray = tagsToCategories([]);
  const existing = await prisma.project.findUnique({
    where: { twitterAccountId: accountId },
    select: { id: true },
  });
  if (existing) return; // already enriched, don't overwrite manual edits
  await prisma.project.create({
    data: {
      twitterAccountId: accountId,
      name: username,
      projectStatus: "discovered",
      chain,
    },
  });
}

export async function passesEarlyStageFilter(user: UserData): Promise<boolean> {
  if (!user.followersCount || user.followersCount >= 10_000) return false;

  const bio = (user.description ?? "") + " " + (user.name ?? "");
  const lower = bio.toLowerCase();

  if (lower.includes("airdrop") || lower.includes("giveaway")) return false;
  const exchangeLower = lower.split(/\s+/);
  for (const term of exchangeLower) {
    if (["binance", "coinbase", "kraken", "okx", "bybit", "kucoin", "huobi", "bitfinex", "gemini"].includes(term)) return false;
  }

  // Use DB-backed tag classification instead of hardcoded keywords
  const tags = await classifyAccount(user);
  const meaningfulTags = tags.filter((t) => t !== DEFAULT_SLUG);
  if (meaningfulTags.length === 0) return false;

  if (!user.createdAt) return false;
  const ageMs = Date.now() - new Date(user.createdAt).getTime();
  const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
  if (ageMs > sixMonthsMs) return false;

  return true;
}

// --- APIUser → UserData adapter ---

function adaptAPIUser(apiUser: APIUser): UserData {
  const result: UserData = {
    id: apiUser.id,
    username: apiUser.screen_name,
    name: apiUser.name,
  };
  if (
    apiUser.description !== undefined &&
    apiUser.description !== null &&
    apiUser.description !== ""
  ) {
    result.description = apiUser.description;
  }
  if (apiUser.followers !== undefined && apiUser.followers !== null) {
    result.followersCount = apiUser.followers;
  }
  if (apiUser.following !== undefined && apiUser.following !== null) {
    result.followingCount = apiUser.following;
  }
  if (apiUser.statuses !== undefined && apiUser.statuses !== null) {
    result.tweetCount = apiUser.statuses;
  }
  if (apiUser.likes !== undefined && apiUser.likes !== null) {
    result.likeCount = apiUser.likes;
  }
  if (apiUser.verification?.verified !== undefined) {
    result.isBlueVerified = apiUser.verification.verified;
  }
  if (apiUser.avatar_url !== undefined && apiUser.avatar_url !== null) {
    result.profileImageUrl = apiUser.avatar_url;
  }
  if (apiUser.banner_url !== undefined && apiUser.banner_url !== null) {
    result.profileBannerUrl = apiUser.banner_url;
  }
  if (
    apiUser.joined !== undefined &&
    apiUser.joined !== null &&
    apiUser.joined !== ""
  ) {
    result.createdAt = apiUser.joined;
  }
  if (
    apiUser.location !== undefined &&
    apiUser.location !== null &&
    apiUser.location !== ""
  ) {
    result.location = apiUser.location;
  }
  return result;
}

// --- Seed import ---

interface SeedEntry {
  username: string;
  category: string;
  label?: string;
}

async function importSeeds(): Promise<void> {
  const ctPath = new URL("./CT.json", import.meta.url);
  const raw = await readFile(ctPath, "utf-8");
  let seeds: SeedEntry[];

  try {
    seeds = JSON.parse(raw) as SeedEntry[];
  } catch {
    console.error("Failed to parse CT.json");
    return;
  }

  let imported = 0;
  const failures: string[] = [];

  for (const seed of seeds) {
    if (!seed.username || !seed.category) {
      failures.push(`${seed.username ?? "unknown"} (missing required fields)`);
      continue;
    }
    // Validate that the category exists in the DB tag lexicon
    const tags = await classifyAccount({ username: seed.username, name: seed.username, description: "" });
    if (!tags.includes(seed.category.toLowerCase()) && seed.category !== "unknown") {
      failures.push(`@${seed.username} (category '${seed.category}' not in tag lexicon)`);
      continue;
    }

    try {
      const fxClient = new FxTwitterClient();
      const profile = await fxClient.getProfile(
        seed.username.replace(/^@/, ""),
      );

      if (!profile.user) {
        failures.push(`@${seed.username} (${profile.reason ?? "not found"})`);
        continue;
      }

      const user = adaptAPIUser(profile.user);

      // Classify tags from bio/name so they're stored immediately, not left for backfill
      const nextTags = await classifyAccount(user);
      const cleanTags = nextTags.filter((t) => t !== DEFAULT_SLUG);
      const tags = cleanTags.length > 0 ? cleanTags : nextTags;

      await prisma.twitterAccount.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          username: user.username,
          name: user.name,
          description: user.description ?? null,
          tags,
          followersCount: user.followersCount ?? null,
          followingCount: user.followingCount ?? null,
          isBlueVerified: user.isBlueVerified ?? null,
          profileImageUrl: user.profileImageUrl ?? null,
          createdAt: user.createdAt ? new Date(user.createdAt) : null,
        },
        update: {
          username: user.username,
          name: user.name,
          description: user.description ?? null,
          tags,
          followersCount: user.followersCount ?? null,
          followingCount: user.followingCount ?? null,
          isBlueVerified: user.isBlueVerified ?? null,
          profileImageUrl: user.profileImageUrl ?? null,
        },
      });

      await prisma.seedAccount.upsert({
        where: { username: seed.username.toLowerCase() },
        create: {
          twitterId: user.id,
          username: seed.username.toLowerCase(),
          category: seed.category,
          label: seed.label ?? null,
          active: true,
        },
        update: {
          twitterId: user.id,
          category: seed.category,
          label: seed.label ?? null,
          active: true,
        },
      });

      imported++;
      console.log(`  ✅ @${seed.username} (${seed.category})`);

      await sleep(2000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      failures.push(`@${seed.username} (${msg})`);
    }
  }

  console.log(`\nImported ${imported}/${seeds.length}`);
  if (failures.length > 0) {
    console.log(`${failures.length} failed:`);
    for (const f of failures) console.log(`  ❌ ${f}`);
  }
}

// --- Batch tracking with fxtwitter cursor pagination ---

interface TrackOptions {
  fullSync?: boolean;
}

/**
 * Fetch all pages of following for a seed using cursor pagination.
 * If seed.followingCursor (top cursor) is set, only new following is returned.
 * Returns { users, newCursorTop }.
 */
async function fetchSeedFollowing(
  fxClient: FxTwitterClient,
  username: string,
  existingFollowingIds: Set<string>,
  pageSize: number,
): Promise<{ users: UserData[]; newCursorTop: string | null }> {
  const allUsers: UserData[] = [];

  // Read stored cursor for this seed to get only new following
  const seed = await prisma.seedAccount.findUnique({
    where: { username: username.toLowerCase() },
    select: { followingCursor: true },
  });

  const hasStoredCursor =
    seed?.followingCursor && seed.followingCursor.length > 0;
  if (hasStoredCursor) {
    console.log(
      `[track] @${username} has stored cursor, fetching only new following`,
    );
  }

  let cursor: string | undefined = hasStoredCursor
    ? seed!.followingCursor!
    : undefined;

  do {
    const response = await fxClient.getProfileFollowing(
      username.replace(/^@/, ""),
      { count: pageSize, ...(cursor ? { cursor } : {}) },
    );

    if (!response.results || response.results.length === 0) {
      console.log(`[track] @${username} no more results`);
      break;
    }

    // Convert APIUser to UserData and filter out already-seen accounts
    for (const apiUser of response.results) {
      const user = adaptAPIUser(apiUser);
      if (!existingFollowingIds.has(user.id)) {
        allUsers.push(user);
      }
    }

    // Capture the top cursor for the next run
    cursor = response.cursor?.top ?? undefined;

    console.log(
      `[track] @${username} page: ${response.results.length} results, ${allUsers.length} new total`,
    );

    if (response.results.length < pageSize) {
      break;
    }

    await sleep(1000);
  } while (cursor && cursor.length > 0);

  return { users: allUsers, newCursorTop: cursor ?? null };
}

export async function runTrackingCycle(
  options: TrackOptions = {},
): Promise<void> {
  const { fullSync = false } = options;
  const pageSize = 100;

  const fxClient = new FxTwitterClient();

  const seeds = await prisma.seedAccount.findMany({
    where: { active: true, twitterId: { not: null } },
  });

  if (seeds.length === 0) {
    console.log("[track] No active seeds found. Run import-seeds first.");
    return;
  }

  const seedTwitterIds = new Set(seeds.map((s) => s.twitterId!));

  // Backup/import can leave tracking_runs_id_seq behind MAX(id) → unique on id.
  let run;
  try {
    run = await prisma.trackingRun.create({
      data: { status: "running" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Unique constraint|tracking_runs_pkey|fields: \(`id`\)/i.test(msg)) {
      throw err;
    }
    console.warn(
      "[track] tracking_runs id sequence out of sync — resyncing and retrying",
    );
    await resyncSerialSequence("tracking_runs");
    run = await prisma.trackingRun.create({
      data: { status: "running" },
    });
  }

  let seedsProcessed = 0;
  let accountsSeen = 0;
  let newEdges = 0;
  const consecutiveErrors = new Map<bigint, number>();

  for (const seed of seeds) {
    try {
      // Get current active following set for this seed
      const existingEdges = await prisma.followEdge.findMany({
        where: { seedId: seed.id, active: true },
        select: { followingId: true },
      });
      const existingFollowingIds = new Set(
        existingEdges.map((e) => e.followingId),
      );

      // Fetch following using fxtwitter with cursor pagination (only new since last cursor)
      const result = await fetchSeedFollowing(
        fxClient,
        seed.username,
        existingFollowingIds,
        pageSize,
      );

      const users = result.users;
      const newCursorTop = result.newCursorTop;
      accountsSeen += users.length;

      // Save cursor.top to seed account for next run
      await prisma.seedAccount.update({
        where: { id: seed.id },
        data: { followingCursor: newCursorTop ?? "" },
      });

      const isPopulationRun = await isFirstRunForSeed(seed.id);

      for (const user of users) {
        // Skip DB store + alert for accounts older than 6 months
        if (user.createdAt) {
          const ageMs = Date.now() - new Date(user.createdAt).getTime();
          const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
          if (ageMs > sixMonthsMs) continue;
        } else {
          continue; // skip if no age info
        }
        // Skip if already stored in db
        const existingAccount = await prisma.twitterAccount.findUnique({
          where: { id: user.id },
        });
        if (existingAccount) continue;

        // Classify tags from bio/name before storing
        const nextTags = await classifyAccount(user);
        const cleanTags = nextTags.filter((t) => t !== DEFAULT_SLUG);
        const tags = cleanTags.length > 0 ? cleanTags : nextTags;

        await prisma.twitterAccount.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            username: user.username,
            name: user.name,
            description: user.description ?? null,
            tags,
            followersCount: user.followersCount ?? null,
            followingCount: user.followingCount ?? null,
            isBlueVerified: user.isBlueVerified ?? null,
            profileImageUrl: user.profileImageUrl ?? null,
            createdAt: user.createdAt ? new Date(user.createdAt) : null,
          },
          update: {
            username: user.username,
            name: user.name,
            description: user.description ?? null,
            tags,
            followersCount: user.followersCount ?? null,
            followingCount: user.followingCount ?? null,
            isBlueVerified: user.isBlueVerified ?? null,
            profileImageUrl: user.profileImageUrl ?? null,
          },
        });

        // Auto-create Project row at first discovery so it shows up in the dashboard immediately.
        await upsertProjectAtDiscovery(user.id, user.username, user.description);

        const existingEdge = await prisma.followEdge.findUnique({
          where: {
            seedId_followingId: { seedId: seed.id, followingId: user.id },
          },
        });

        if (existingEdge) {
          await prisma.followEdge.update({
            where: {
              seedId_followingId: { seedId: seed.id, followingId: user.id },
            },
            data: {
              lastSeenAt: new Date(),
              lastSeenRunId: run.id,
              active: true,
            },
          });
          // Existing follow in DB: skip new-follow alert, but send convergence if applicable.
          if (!isPopulationRun && !seedTwitterIds.has(user.id)) {
            await checkAndAlertConvergence(user, run.id);
          }
        } else {
          await prisma.followEdge.create({
            data: {
              seedId: seed.id,
              followingId: user.id,
              firstSeenRunId: run.id,
              lastSeenRunId: run.id,
              active: true,
            },
          });
          newEdges++;
          const msgFormat = await formatNewFollowAlert(seed.username, user);
          await sendTelegramAlert(msgFormat, "MarkdownV2", undefined, "newFollow");

          if (!isPopulationRun && (await passesEarlyStageFilter(user)) && !seedTwitterIds.has(user.id)) {
            await checkAndAlertConvergence(user, run.id);
          }
        }
      }

      if (fullSync) {
        // Full sync: fetch ALL following pages (without stored cursor),
        // compare with existing and mark unfollowed edges as inactive
        await markUnfollowedEdgesFullSync(
          fxClient,
          seed,
          existingFollowingIds,
          pageSize,
        );
      }

      seedsProcessed++;
      console.log(
        `[track] @${seed.username}: ${users.length} new following, ${newEdges} new edges, cursor saved`,
      );

      await sleep(3000);
    } catch (error) {
      console.error(`[track] Error processing @${seed.username}:`, error);
      const errCount = (consecutiveErrors.get(seed.id) ?? 0) + 1;
      consecutiveErrors.set(seed.id, errCount);

      if (errCount >= 3) {
        await prisma.seedAccount.update({
          where: { id: seed.id },
          data: { active: false },
        });

        await sendTelegramPlaintext(
          `⚠️ Seed @${seed.username} deactivated after 3 consecutive errors.`,
        );
        console.log(`[track] Seed @${seed.username} deactivated (3 errors)`);
      }
    }
  }

  await prisma.trackingRun.update({
    where: { id: run.id },
    data: {
      status: "completed",
      finishedAt: new Date(),
      seedsProcessed,
      accountsSeen,
      newFollowEdges: newEdges,
    },
  });

  console.log(
    `[track] Run #${run.id} complete: ${seedsProcessed} seeds, ${accountsSeen} accounts, ${newEdges} new edges`,
  );
}

/**
 * Full sync: fetch all following pages (without stored cursor),
 * compare with existing edges and mark unfollowed as inactive.
 */
async function markUnfollowedEdgesFullSync(
  fxClient: FxTwitterClient,
  seed: { id: bigint; username: string },
  currentFollowingIds: Set<string>,
  pageSize: number,
): Promise<void> {
  const allFollowingIds = new Set<string>();
  let cursor: string | undefined = undefined;

  do {
    const response = await fxClient.getProfileFollowing(
      seed.username.replace(/^@/, ""),
      { count: pageSize, ...(cursor ? { cursor } : {}) },
    );

    if (!response.results || response.results.length === 0) {
      break;
    }

    for (const apiUser of response.results) {
      allFollowingIds.add(apiUser.id);
    }

    cursor = response.cursor?.top || undefined;

    if (response.results.length < pageSize) {
      break;
    }

    await sleep(1000);
  } while (cursor && cursor.length > 0);

  const unfollowedIds = [...currentFollowingIds].filter(
    (id) => !allFollowingIds.has(id),
  );

  if (unfollowedIds.length > 0) {
    await prisma.followEdge.updateMany({
      where: {
        seedId: seed.id,
        followingId: { in: unfollowedIds },
      },
      data: { active: false },
    });
    console.log(
      `[track] Marked ${unfollowedIds.length} edges inactive for @${seed.username}`,
    );
  }
}

async function isFirstRunForSeed(seedId: bigint): Promise<boolean> {
  const edgeCount = await prisma.followEdge.count({
    where: { seedId },
  });
  return edgeCount === 0;
}

// --- Convergence detection ---

async function checkAndAlertConvergence(
  target: UserData,
  runId: bigint,
): Promise<void> {
  const windowMs = 72 * 60 * 60 * 1000;
  const windowStart = new Date(Date.now() - windowMs);

  const edges = await prisma.followEdge.findMany({
    where: {
      followingId: target.id,
      active: true,
      firstSeenAt: { gte: windowStart },
    },
    select: { seedId: true },
    distinct: ["seedId"],
  });

  const convergenceCount = edges.length;
  // Only alert for early-stage accounts (<6 months) with non-empty tags from DB
  const tags = await classifyAccount({ username: target.username, name: target.name ?? "", description: target.description ?? null });
  const meaningfulTags = tags.filter((t) => t !== DEFAULT_SLUG);
  if (meaningfulTags.length === 0) return;

  if (convergenceCount < 2) return;

  const recentAlert = await prisma.alert.findFirst({
    where: {
      followingId: target.id,
      alertType: "convergence",
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  const seedAccounts = await prisma.seedAccount.findMany({
    where: { id: { in: edges.map((e) => e.seedId) } },
    select: { username: true },
  });
  const seedUsernames = seedAccounts.map((s) => s.username);

  if (recentAlert) {
    await prisma.alert.update({
      where: { id: recentAlert.id },
      data: {
        score: convergenceCount,
        seedCount: convergenceCount,
        seedUsernames,
        categories: meaningfulTags,
      },
    });
    return;
  }

  await prisma.alert.create({
    data: {
      followingId: target.id,
      runId,
      alertType: "convergence",
      score: convergenceCount,
      seedCount: convergenceCount,
      seedUsernames,
      categories: meaningfulTags,
      reason: `${convergenceCount} seeds followed within 72h`,
    },
  });

  // Promote the Project row to "investigating" now that convergence was detected.
  const accForProject = await prisma.twitterAccount.findUnique({
    where: { id: target.id },
    select: { description: true, username: true },
  });
  if (accForProject) {
    const { chain } = enrichFromBio(accForProject.description, accForProject.username);
    const { tagsToCategories } = await import("../../services/projectTagger.js");
    const catArray = tagsToCategories([]);
    await prisma.project.upsert({
      where: { twitterAccountId: target.id },
      create: {
        twitterAccountId: target.id,
        name: accForProject.username,
        category: catArray,
        projectStatus: "investigating",
        chain,
      },
      update: {
        category: catArray,
        chain,
        projectStatus: "investigating",
      },
    });
  }

  const alertData: ConvergenceAlertData = {
    targetUsername: target.username,
    targetName: target.name,
    targetBio: target.description ?? null,
    targetFollowerCount: target.followersCount ?? 0,
    targetAccountAge: target.createdAt ? getAccountAge(target.createdAt) : null,
    seedUsernames,
    categories: meaningfulTags,
    score: convergenceCount,
  };

  try {
    if (await isAlertEnabled("convergence")) {
      await sendTelegramAlert(
        { text: formatConvergenceAlert(alertData), user: target },
        "MarkdownV2",
        undefined,
        "convergence",
      );
    }
  } catch (error) {
    console.error(
      `[track] Failed to send convergence alert for @${target.username}:`,
      error,
    );
  }
}

// --- Daily digest ---

export async function sendDailyDigestMessage(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentEdges = await prisma.followEdge.findMany({
    where: {
      firstSeenAt: { gte: since },
      active: true,
    },
    include: {
      seed: true,
      following: true,
    },
  });

  const seedTwitterIds = new Set(
    (
      await prisma.seedAccount.findMany({
        where: { active: true },
        select: { twitterId: true },
      })
    )
      .map((s) => s.twitterId)
      .filter(Boolean),
  );

  const convergenceTargets = new Set(
    (
      await prisma.alert.findMany({
        where: { alertType: "convergence", createdAt: { gte: since } },
        select: { followingId: true },
      })
    ).map((a) => a.followingId),
  );

  const digestEntries: DigestEntry[] = [];
  const categorized = new Map<string, DigestEntry[]>();

  for (const edge of recentEdges) {
    if (convergenceTargets.has(edge.followingId)) continue;
    if (seedTwitterIds.has(edge.followingId)) continue;

    const user = edge.following;
    if (!user.followersCount || user.followersCount >= 10_000) continue;

    const tags = await classifyAccount({ username: user.username, name: user.name, description: user.description });
    const meaningfulTags = tags.filter((t) => t !== DEFAULT_SLUG);
    if (meaningfulTags.length === 0) continue;

    const entry: DigestEntry = {
      seedUsername: edge.seed.username,
      targetUsername: user.username,
      targetFollowerCount: user.followersCount,
      targetBio: user.description,
    };

    digestEntries.push(entry);

    const cat = meaningfulTags[0] ?? "Uncategorized";
    if (!categorized.has(cat)) categorized.set(cat, []);
    categorized.get(cat)!.push(entry);
  }

  if (digestEntries.length === 0) {
    const { markDailyDigestSent } =
      await import("../../services/digestCatchUp.js");
    await markDailyDigestSent();
    console.log("[digest] No entries in last 24h — marker set");
    return;
  }

  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const message = formatDailyDigest(digestEntries, categorized, today);

  if (message) {
    try {
      await sendTelegramPlaintext(message, "MarkdownV2");
      const { markDailyDigestSent } =
        await import("../../services/digestCatchUp.js");
      await markDailyDigestSent();
      console.log(
        `[digest] Sent daily digest with ${digestEntries.length} entries`,
      );
    } catch (error) {
      console.error("[digest] Failed to send daily digest:", error);
    }
  }
}

// --- Health check ---

export async function checkHealth(): Promise<void> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const recentEdges = await prisma.followEdge.count({
    where: { firstSeenAt: { gte: sixHoursAgo } },
  });

  if (recentEdges === 0) {
    const lastRun = await prisma.trackingRun.findFirst({
      orderBy: { startedAt: "desc" },
    });

    const lastRunInfo = lastRun
      ? `Last run: ${lastRun.startedAt.toISOString()} (status: ${lastRun.status})`
      : "No tracking runs found";

    await sendTelegramPlaintext(
      `🚨 HEALTH CHECK: No new FollowEdge records in 6 hours.\n${lastRunInfo}\nCheck if the tracker is running and auth accounts are active.`,
    );
    console.log("[health] Alert sent: no new edges in 6 hours");
  }
}

// --- Utilities ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- CLI ---

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;

if (isMain) {
  const command = process.argv[2];

  switch (command) {
    case "import-seeds":
      console.log("Importing seeds from CT.json...\n");
      await importSeeds();
      break;

    case "track":
      console.log("[track] Starting tracking cycle...");
      await runTrackingCycle({ fullSync: false });
      break;

    case "track-full":
      console.log("[track] Starting full sync tracking cycle...");
      await runTrackingCycle({ fullSync: true });
      break;

    case "digest":
      console.log("[digest] Sending daily digest...");
      await sendDailyDigestMessage();
      break;

    case "health":
      console.log("[health] Running health check...");
      await checkHealth();
      break;

    default:
      console.log("Usage: track.ts <command>");
      console.log("Commands:");
      console.log("  import-seeds  Import seed accounts from CT.json");
      console.log(
        "  track         Run tracking cycle (cursor pagination, only new following)",
      );
      console.log(
        "  track-full    Run full sync (all pages, detect unfollows)",
      );
      console.log("  digest        Send daily digest");
      console.log("  health        Run health check");
      break;
  }
}
