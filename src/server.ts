// Express app assembly — mounts the routers behind API-key auth, with a public
// health check and a central error handler. Kept separate from index.ts so it
// can be imported by tests without binding a port.

import express, { type Express, type Request, type Response } from "express";
import { requireApiKey } from "./middleware/auth.js";
import { errorMiddleware } from "./middleware/error.js";
import { tagsListsRouter } from "./routes/tags-lists.js";
import { watchingRouter } from "./routes/watching.js";
import { growthRouter } from "./routes/growth.js";
import { authPoolRouter } from "./routes/auth-pool.js";
import { jobsRouter } from "./routes/jobs.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { metricsRouter } from "./routes/metrics.js";
import { settingsRouter } from "./routes/settings.js";
import { searchRouter } from "./routes/search.js";
import { queuesRouter } from "./routes/queues.js";
import { tgRouter } from "./routes/tg.js";
import { searchQueriesRouter } from "./routes/search-queries.js";
import { listMonitorsRouter } from "./routes/list-monitors.js";
import { twitterListsRouter } from "./routes/twitter-lists.js";
import { chainlistRouter } from "./routes/chainlist.js";
import { githubReposRouter } from "./routes/github-repos.js";
import { grokRouter } from "./routes/grok.js";
import { backupRouter } from "./routes/backup.js";
import { hunterRouter } from "./routes/hunter.js";
import { monitorsRouter } from "./routes/monitors.js";
import { signalScansRouter } from "./routes/signal-scans.js";
import { seedsRouter } from "./routes/seeds.js";

export function createApp(): Express {
  const app = express();
  // Large enough for full DB JSON import/export payloads.
  app.use(express.json({ limit: "100mb" }));

  // Public: liveness only, no secrets, no auth.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "early-alpha-admin-api" });
  });

  // Everything below requires the admin API key.
  app.use("/api", requireApiKey);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/metrics", metricsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/search-queries", searchQueriesRouter);
  app.use("/api/list-monitors", listMonitorsRouter);
  app.use("/api/twitter-lists", twitterListsRouter);
  app.use("/api/chainlist", chainlistRouter);
  app.use("/api/github-repos", githubReposRouter);
  app.use("/api/queues", queuesRouter);
  app.use("/api/tg", tgRouter);
  app.use("/api/grok", grokRouter);
  app.use("/api/hunter", hunterRouter);
  app.use("/api/monitors", monitorsRouter);
  app.use("/api/backup", backupRouter);
  app.use("/api/seeds", seedsRouter);
    app.use("/api/growth", growthRouter);
  app.use("/api/watching", watchingRouter);
  app.use("/api", tagsListsRouter); // /api/projects, /api/lists, /api/reclassify, ...
  app.use("/api/signals", signalScansRouter);
  app.use("/api/auth-accounts", authPoolRouter);
  app.use("/api/jobs", jobsRouter);

  app.use(errorMiddleware);
  return app;
}
