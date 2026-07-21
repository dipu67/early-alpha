import "dotenv/config";
import "./src/services/seedWorker.js";
import "./src/services/listWorker.js";
import { registerAllSchedulers } from "./src/services/queue.js";
import { startMainBot } from "./src/tg/bots.js";
import { startGrokBot } from "./src/tg/grokBot.js";

export { prisma } from "./src/db/prisma.js";
export { getTwitterClient, markRateLimited } from "./src/twitter/getClient.js";
export { TwitterClient } from "./src/TwitterClient/TwitterClient.js";

import { createApp } from "./src/server.js";
import { env } from "./src/env.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`[api] early-alpha admin API listening on :${env.port}`);
});

// Bots load tokens from telegram_bots (DB). Failures are logged; API continues.
function startBot(name: string, start: () => Promise<void> | void): void {
  Promise.resolve()
    .then(() => start())
    .then(() => console.log(`[bot] ${name} started`))
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bot] ${name} failed to start (API continues):`, msg);
    });
}

startBot("Telegram", () => startMainBot());
startBot("Grok", () => startGrokBot());

await registerAllSchedulers();
console.log("[scheduler] Schedulers registered from registry");

// Catch digests missed while the process was down (marker-based; no flood on first boot).
void import("./src/services/digestCatchUp.js")
  .then(({ catchUpMissedDigests }) => catchUpMissedDigests())
  .then((r) =>
    console.log(
      `[digest-catchup] done daily=${r.daily} early=${r.early}`,
    ),
  )
  .catch((err) =>
    console.error("[digest-catchup] failed:", err),
  );
