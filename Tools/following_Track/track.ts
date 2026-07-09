import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../../db/prisma.js";
import { getTwitterClient, markRateLimited } from "../../twitter/getClient.js";
import type { UserData } from "../../TwitterClient/types.js";
import { sendTelegramAlert, sendTelegramPlaintext } from "../../tg/sendAlert.js";
import {
  formatConvergenceAlert,
  type ConvergenceAlertData,
  type DigestEntry,
  formatDailyDigest,
  getAccountAge,
} from "../../services/formatAlert.js";

// --- Category tagging ---

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  DeFi: ["defi", "dex", "swap", "yield", "lending", "liquidity", "amm", "vault", "staking"],
  NFT: ["nft", "nfts", "collectible", "pfp", "mint", "opensea"],
  L1: ["layer 1", "l1", "blockchain", "chain", "mainnet"],
  L2: ["layer 2", "l2", "rollup", "zk", "optimistic", "arbitrum", "optimism", "base", "zksync", "starknet"],
  GameFi: ["gamefi", "play-to-earn", "p2e", "gaming", "metaverse", "web3 game"],
};

const EXCHANGE_NAMES = ["binance", "coinbase", "kraken", "okx", "bybit", "kucoin", "huobi", "bitfinex", "gemini"];
const EXCLUDE_BIO_TERMS = ["airdrop", "giveaway"];

export function categorizeFromBio(bio: string | null | undefined): string[] {
  if (!bio) return [];
  const lower = bio.toLowerCase();
  const matched: string[] = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(lower)) {
        matched.push(category);
        break;
      }
    }
  }

  return matched;
}

export function passesEarlyStageFilter(user: UserData): boolean {
  if (!user.followersCount || user.followersCount >= 10_000) return false;

  const bio = (user.description ?? "") + " " + (user.name ?? "");
  const lower = bio.toLowerCase();

  for (const term of EXCLUDE_BIO_TERMS) {
    if (lower.includes(term)) return false;
  }
  for (const exchange of EXCHANGE_NAMES) {
    if (lower.includes(exchange)) return false;
  }

  const categories = categorizeFromBio(user.description);
  if (categories.length === 0) return false;

  if (user.createdAt) {
    const ageMs = Date.now() - new Date(user.createdAt).getTime();
    const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
    if (ageMs > sixMonthsMs) return false;
  }

  return true;
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

  const validCategories = new Set(Object.keys(CATEGORY_KEYWORDS));
  let imported = 0;
  const failures: string[] = [];

  for (const seed of seeds) {
    if (!seed.username || !seed.category) {
      failures.push(`${seed.username ?? "unknown"} (missing required fields)`);
      continue;
    }
    if (!validCategories.has(seed.category)) {
      failures.push(`@${seed.username} (invalid category: ${seed.category})`);
      continue;
    }

    try {
      const { client, accountId } = await getTwitterClient();
      const result = await client.getUserByScreenName(seed.username);

      if (result.rateLimit && result.rateLimit.remaining === 0) {
        await markRateLimited(accountId, result.rateLimit.reset);
      }

      if (!result.success || !result.user) {
        failures.push(`@${seed.username} (${result.error ?? "not found"})`);
        continue;
      }

      const user = result.user;

      await prisma.twitterAccount.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          username: user.username,
          name: user.name,
          description: user.description ?? null,
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

// --- Batch tracking ---

interface TrackOptions {
  fullSync?: boolean;
}

export async function runTrackingCycle(options: TrackOptions = {}): Promise<void> {
  const { fullSync = false } = options;
  const fetchCount = fullSync ? 5000 : 200;

  const seeds = await prisma.seedAccount.findMany({
    where: { active: true, twitterId: { not: null } },
  });

  if (seeds.length === 0) {
    console.log("[track] No active seeds found. Run import-seeds first.");
    return;
  }

  const seedTwitterIds = new Set(seeds.map(s => s.twitterId!));

  const run = await prisma.trackingRun.create({
    data: { status: "running" },
  });

  let seedsProcessed = 0;
  let accountsSeen = 0;
  let newEdges = 0;
  const consecutiveErrors = new Map<bigint, number>();

  for (const seed of seeds) {
    try {
      const { client, accountId } = await getTwitterClient();
      const result = await client.getFollowing(seed.twitterId!, fetchCount);

      if (result.rateLimit && result.rateLimit.remaining === 0) {
        await markRateLimited(accountId, result.rateLimit.reset);
      }

      if (!result.success || !result.users) {
        const errCount = (consecutiveErrors.get(seed.id) ?? 0) + 1;
        consecutiveErrors.set(seed.id, errCount);

        if (errCount >= 3) {
          await prisma.seedAccount.update({
            where: { id: seed.id },
            data: { active: false },
          });
          await sendTelegramPlaintext(
            `⚠️ Seed @${seed.username} deactivated after 3 consecutive errors. May be private or suspended.`,
          );
          console.log(`[track] Seed @${seed.username} deactivated (3 errors)`);
        }
        continue;
      }

      consecutiveErrors.delete(seed.id);
      const users = result.users;
      accountsSeen += users.length;

      const isPopulationRun = await isFirstRunForSeed(seed.id);
      const currentFollowingIds = new Set<string>();

      for (const user of users) {
        currentFollowingIds.add(user.id);

        await prisma.twitterAccount.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            username: user.username,
            name: user.name,
            description: user.description ?? null,
            followersCount: user.followersCount ?? null,
            followingCount: user.followingCount ?? null,
            isBlueVerified: user.isBlueVerified ?? null,
            profileImageUrl: user.profileImageUrl ?? null,
            createdAt: user.createdAt ? new Date(user.createdAt) : null,
          },
          update: {
            username: user.username,
            name: user.name,
            followersCount: user.followersCount ?? null,
            followingCount: user.followingCount ?? null,
            isBlueVerified: user.isBlueVerified ?? null,
            profileImageUrl: user.profileImageUrl ?? null,
          },
        });

        const existingEdge = await prisma.followEdge.findUnique({
          where: { seedId_followingId: { seedId: seed.id, followingId: user.id } },
        });

        if (existingEdge) {
          await prisma.followEdge.update({
            where: { seedId_followingId: { seedId: seed.id, followingId: user.id } },
            data: { lastSeenAt: new Date(), lastSeenRunId: run.id, active: true },
          });
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

          if (!isPopulationRun) {
            const categories = categorizeFromBio(user.description);

            if (passesEarlyStageFilter(user) && !seedTwitterIds.has(user.id)) {
              await checkAndAlertConvergence(user, categories, run.id);
            }
          }
        }
      }

      if (fullSync) {
        await markUnfollowedEdges(seed.id, currentFollowingIds);
      }

      seedsProcessed++;
      console.log(`[track] @${seed.username}: ${users.length} following, ${newEdges} new edges`);

      await sleep(3000);
    } catch (error) {
      console.error(`[track] Error processing @${seed.username}:`, error);
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

  console.log(`[track] Run #${run.id} complete: ${seedsProcessed} seeds, ${accountsSeen} accounts, ${newEdges} new edges`);
}

async function isFirstRunForSeed(seedId: bigint): Promise<boolean> {
  const edgeCount = await prisma.followEdge.count({
    where: { seedId },
  });
  return edgeCount === 0;
}

async function markUnfollowedEdges(seedId: bigint, currentFollowingIds: Set<string>): Promise<void> {
  const activeEdges = await prisma.followEdge.findMany({
    where: { seedId, active: true },
    select: { followingId: true },
  });

  const unfollowedIds = activeEdges
    .filter(e => !currentFollowingIds.has(e.followingId))
    .map(e => e.followingId);

  if (unfollowedIds.length > 0) {
    await prisma.followEdge.updateMany({
      where: {
        seedId,
        followingId: { in: unfollowedIds },
      },
      data: { active: false },
    });
    console.log(`[track] Marked ${unfollowedIds.length} edges inactive for seed ${seedId}`);
  }
}

// --- Convergence detection ---

async function checkAndAlertConvergence(
  target: UserData,
  categories: string[],
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
  if (convergenceCount < 2) return;

  const recentAlert = await prisma.alert.findFirst({
    where: {
      followingId: target.id,
      alertType: "convergence",
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  const seedAccounts = await prisma.seedAccount.findMany({
    where: { id: { in: edges.map(e => e.seedId) } },
    select: { username: true },
  });
  const seedUsernames = seedAccounts.map(s => s.username);

  if (recentAlert) {
    await prisma.alert.update({
      where: { id: recentAlert.id },
      data: {
        score: convergenceCount,
        seedCount: convergenceCount,
        seedUsernames,
        categories,
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
      categories,
      reason: `${convergenceCount} seeds followed within 72h`,
    },
  });

  const alertData: ConvergenceAlertData = {
    targetUsername: target.username,
    targetName: target.name,
    targetBio: target.description ?? null,
    targetFollowerCount: target.followersCount ?? 0,
    targetAccountAge: target.createdAt ? getAccountAge(target.createdAt) : null,
    seedUsernames,
    categories,
    score: convergenceCount,
  };

  try {
    await sendTelegramAlert({ text: formatConvergenceAlert(alertData), user: target });
  } catch (error) {
    console.error(`[track] Failed to send convergence alert for @${target.username}:`, error);
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
    (await prisma.seedAccount.findMany({ where: { active: true }, select: { twitterId: true } }))
      .map(s => s.twitterId)
      .filter(Boolean),
  );

  const convergenceTargets = new Set(
    (await prisma.alert.findMany({
      where: { alertType: "convergence", createdAt: { gte: since } },
      select: { followingId: true },
    })).map(a => a.followingId),
  );

  const digestEntries: DigestEntry[] = [];
  const categorized = new Map<string, DigestEntry[]>();

  for (const edge of recentEdges) {
    if (convergenceTargets.has(edge.followingId)) continue;
    if (seedTwitterIds.has(edge.followingId)) continue;

    const user = edge.following;
    if (!user.followersCount || user.followersCount >= 10_000) continue;

    const categories = categorizeFromBio(user.description);
    if (categories.length === 0) continue;

    const entry: DigestEntry = {
      seedUsername: edge.seed.username,
      targetUsername: user.username,
      targetFollowerCount: user.followersCount,
      targetBio: user.description,
    };

    digestEntries.push(entry);

    const cat = categories[0] ?? "Uncategorized";
    if (!categorized.has(cat)) categorized.set(cat, []);
    categorized.get(cat)!.push(entry);
  }

  if (digestEntries.length === 0) return;

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const message = formatDailyDigest(digestEntries, categorized, today);

  if (message) {
    try {
      await sendTelegramPlaintext(message);
      console.log(`[digest] Sent daily digest with ${digestEntries.length} entries`);
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
  return new Promise(resolve => setTimeout(resolve, ms));
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
      console.log("  track         Run tracking cycle (3 pages per seed)");
      console.log("  track-full    Run full sync (all pages, detect unfollows)");
      console.log("  digest        Send daily digest");
      console.log("  health        Run health check");
      break;
  }
}
