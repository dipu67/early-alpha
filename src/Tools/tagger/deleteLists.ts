import "dotenv/config";
import { prisma } from "../../db/prisma.js";
import { getListClient } from "../../twitter/getClient.js";
import { VALID_SLUGS, tagLabel } from "../../services/projectTagger.js";
import { ALPHA_SLUG } from "../../services/projectLists.js";

// Delete the project's Twitter lists and reset local list state.
//
//   npm run list:delete           # delete only lists this bot created (by name)
//   npm run list:delete -- --all  # delete EVERY list the owner account owns
//
// After deletion it clears project_lists + list_members and nulls
// lists_synced_at so the next reconcile cycle rebuilds a clean single list set.

const DELETE_ALL = process.argv.includes("--all");

/** Names of the lists this system creates (tag labels + the alpha bucket). */
function knownListNames(): Set<string> {
  const names = new Set<string>();
  for (const slug of VALID_SLUGS) {
    if (slug === "unknown" || slug === "other") continue;
    names.add(tagLabel(slug));
  }
  names.add("Alpha / Unknown"); // ALPHA_SLUG label
  return names;
}

async function main(): Promise<void> {
  const { client } = await getListClient();

  const res = await client.getMyLists(1000);
  if (!res.success || !res.lists) {
    throw new Error(`getMyLists failed: ${res.error ?? "unknown"}`);
  }

  const known = knownListNames();
  const targets = DELETE_ALL
    ? res.lists
    : res.lists.filter((l) => known.has(l.name));

  console.log(
    `[list:delete] ${res.lists.length} owned lists; deleting ${targets.length} ` +
      `(${DELETE_ALL ? "ALL" : "project lists only"})`,
  );

  let deleted = 0;
  for (const list of targets) {
    const del = await client.deleteList(list.id);
    if (del.success) {
      deleted++;
      console.log(`[list:delete] deleted "${list.name}" (${list.id})`);
    } else {
      console.warn(`[list:delete] "${list.name}" (${list.id}) failed: ${del.error ?? "unknown"}`);
    }
    // gentle pacing to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  // Reset local state so reconcile rebuilds cleanly.
  await prisma.listMember.deleteMany({});
  await prisma.projectList.deleteMany({});
  await prisma.twitterAccount.updateMany({ data: { listsSyncedAt: null } });

  console.log(`[list:delete] done — deleted ${deleted}/${targets.length} lists, local state reset`);
}

main()
  .catch((err) => {
    console.error("[list:delete] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
