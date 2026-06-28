import { prisma } from "../db/prisma.js";
import { getTwitterClient, markRateLimited } from "../twitter/getClient.js";

const entry = await prisma.watchList.findUniqueOrThrow({
  where: { id: 1n },
});

console.log("entry", entry);