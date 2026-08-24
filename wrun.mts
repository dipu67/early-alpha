import "dotenv/config";
import { prisma } from "./src/db/prisma.js";
import { pollWatchingProjects } from "./src/services/watchingPoller.js";

const before = await prisma.twitterAccount.findMany({
  where: { project: { projectStatus: "watching" } },
  select: { username: true, fxCursor: true, lastTweetId: true },
});
console.log("BEFORE:", before.map(a => `${a.username} cursor=${a.fxCursor ? "set" : "null"} lastTweetId=${a.lastTweetId ?? "null"}`).join("\n        "));
const r = await pollWatchingProjects();
console.log("RESULT:", JSON.stringify(r));
const after = await prisma.twitterAccount.findMany({
  where: { project: { projectStatus: "watching" } },
  select: { username: true, fxCursor: true, lastTweetId: true },
});
console.log("AFTER: ", after.map(a => `${a.username} cursor=${a.fxCursor ? "set" : "null"} lastTweetId=${a.lastTweetId ?? "null"}`).join("\n        "));
await prisma.$disconnect();
