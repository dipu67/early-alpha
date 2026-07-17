// GitHub repo commit monitors admin API.
//
//   GET    /github-repos              list monitors
//   POST   /github-repos              create (owner/repo or github URL)
//   POST   /github-repos/seed         ensure DefiLlama/chainlist default
//   PATCH  /github-repos/:id          update label / path / topic / interval / …
//   DELETE /github-repos/:id          delete
//   POST   /github-repos/:id/run      poll now (ignore interval)
//   POST   /github-repos/run-all      enqueue poll-github-repos job
//   GET    /github-repos/commits      recent commits

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { paginationSchema, jsonSafe } from "../http.js";
import { enqueueJob } from "../enqueue.js";
import {
  createGithubRepoMonitor,
  ensureDefaultGithubRepos,
  parseGithubRepoInput,
  pollGithubRepoMonitor,
} from "../services/githubRepoPoller.js";

export const githubReposRouter: Router = Router();

function parseId(raw: string | string[] | undefined): bigint {
  const s = Array.isArray(raw) ? raw[0] : raw;
  try {
    return BigInt(s ?? "");
  } catch {
    throw new HttpError(400, `invalid id: ${String(s)}`);
  }
}

function viewMonitor(m: {
  id: bigint;
  owner: string;
  repo: string;
  fullName: string;
  label: string | null;
  description: string | null;
  enabled: boolean;
  alertEnabled: boolean;
  topicId: number | null;
  branch: string;
  pathFilter: string | null;
  intervalSec: number;
  lastPolledAt: Date | null;
  lastCommitSha: string | null;
  lastError: string | null;
  hitCount: number;
  createdAt: Date;
  _count?: { commits: number };
}) {
  return {
    id: m.id.toString(),
    owner: m.owner,
    repo: m.repo,
    fullName: m.fullName,
    label: m.label,
    description: m.description,
    enabled: m.enabled,
    alertEnabled: m.alertEnabled,
    topicId: m.topicId,
    branch: m.branch,
    pathFilter: m.pathFilter,
    intervalSec: m.intervalSec,
    lastPolledAt: m.lastPolledAt,
    lastCommitSha: m.lastCommitSha,
    lastError: m.lastError,
    hitCount: m.hitCount,
    recentCommitCount: m._count?.commits,
    repoUrl: `https://github.com/${m.fullName}`,
    createdAt: m.createdAt,
  };
}

githubReposRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    await ensureDefaultGithubRepos();
    const items = await prisma.githubRepoMonitor.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { commits: true } } },
    });
    res.json({ items: jsonSafe(items.map(viewMonitor)) });
  }),
);

githubReposRouter.get(
  "/commits",
  asyncHandler(async (req, res) => {
    const q = paginationSchema
      .extend({ monitorId: z.string().optional() })
      .parse(req.query);
    const where = q.monitorId ? { monitorId: BigInt(q.monitorId) } : {};
    const [items, total] = await Promise.all([
      prisma.githubRepoCommit.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: q.limit,
        skip: q.offset,
        include: {
          monitor: {
            select: {
              id: true,
              fullName: true,
              label: true,
              pathFilter: true,
            },
          },
        },
      }),
      prisma.githubRepoCommit.count({ where }),
    ]);
    res.json({
      total,
      limit: q.limit,
      offset: q.offset,
      items: jsonSafe(
        items.map((c) => ({
          id: c.id.toString(),
          monitorId: c.monitorId.toString(),
          fullName: c.monitor.fullName,
          label: c.monitor.label,
          pathFilter: c.monitor.pathFilter,
          sha: c.sha,
          shortSha: c.sha.slice(0, 7),
          message: c.message,
          authorName: c.authorName,
          authorLogin: c.authorLogin,
          htmlUrl: c.htmlUrl,
          committedAt: c.committedAt,
          filesAdded: c.filesAdded,
          filesModified: c.filesModified,
          filesRemoved: c.filesRemoved,
          alerted: c.alerted,
          createdAt: c.createdAt,
        })),
      ),
    });
  }),
);

githubReposRouter.post(
  "/seed",
  asyncHandler(async (_req, res) => {
    const result = await ensureDefaultGithubRepos();
    const row = await prisma.githubRepoMonitor.findUniqueOrThrow({
      where: { id: BigInt(result.monitorId) },
      include: { _count: { select: { commits: true } } },
    });
    res.json({
      ok: true,
      created: result.created,
      item: jsonSafe(viewMonitor(row)),
    });
  }),
);

githubReposRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        repo: z.string().min(1),
        label: z.string().max(200).nullable().optional(),
        pathFilter: z.string().max(500).nullable().optional(),
        branch: z.string().max(200).nullable().optional(),
        topicId: z.number().int().nullable().optional(),
        intervalSec: z.number().int().min(60).max(86_400).optional(),
        alertEnabled: z.boolean().optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const parsed = parseGithubRepoInput(body.repo);
    if (!parsed) throw new HttpError(400, "invalid_repo");

    const fullName = `${parsed.owner}/${parsed.repo}`;
    const existing = await prisma.githubRepoMonitor.findUnique({
      where: { fullName },
    });
    if (existing) throw new HttpError(409, "repo_already_monitored");

    try {
      const createInput: Parameters<typeof createGithubRepoMonitor>[0] = {
        owner: parsed.owner,
        repo: parsed.repo,
        label: body.label ?? null,
        pathFilter: body.pathFilter ?? null,
        branch: body.branch ?? null,
        topicId: body.topicId ?? null,
      };
      if (body.intervalSec !== undefined) createInput.intervalSec = body.intervalSec;
      if (body.alertEnabled !== undefined)
        createInput.alertEnabled = body.alertEnabled;
      if (body.enabled !== undefined) createInput.enabled = body.enabled;

      const row = await createGithubRepoMonitor(createInput);
      res.status(201).json({
        item: jsonSafe(
          viewMonitor({ ...row, _count: { commits: 0 } }),
        ),
      });
    } catch (err) {
      if (err instanceof Error && err.message === "repo_not_found") {
        throw new HttpError(404, "repo_not_found");
      }
      throw err;
    }
  }),
);

githubReposRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = z
      .object({
        label: z.string().max(200).nullable().optional(),
        pathFilter: z.string().max(500).nullable().optional(),
        branch: z.string().min(1).max(200).optional(),
        topicId: z.number().int().nullable().optional(),
        intervalSec: z.number().int().min(60).max(86_400).optional(),
        alertEnabled: z.boolean().optional(),
        enabled: z.boolean().optional(),
        /** Reset watermark so next poll re-seeds without alerts */
        resetWatermark: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const existing = await prisma.githubRepoMonitor.findUnique({
      where: { id },
    });
    if (!existing) throw new HttpError(404, "not_found");

    const data: Record<string, unknown> = {};
    if (body.label !== undefined) data.label = body.label;
    if (body.pathFilter !== undefined) data.pathFilter = body.pathFilter;
    if (body.branch !== undefined) data.branch = body.branch;
    if (body.topicId !== undefined) data.topicId = body.topicId;
    if (body.intervalSec !== undefined) data.intervalSec = body.intervalSec;
    if (body.alertEnabled !== undefined) data.alertEnabled = body.alertEnabled;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.resetWatermark) {
      data.lastCommitSha = null;
      data.lastPolledAt = null;
      data.lastError = null;
    }

    const row = await prisma.githubRepoMonitor.update({
      where: { id },
      data,
      include: { _count: { select: { commits: true } } },
    });
    res.json({ item: jsonSafe(viewMonitor(row)) });
  }),
);

githubReposRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.githubRepoMonitor.findUnique({
      where: { id },
    });
    if (!existing) throw new HttpError(404, "not_found");
    await prisma.githubRepoMonitor.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

githubReposRouter.post(
  "/run-all",
  asyncHandler(async (_req, res) => {
    const result = await enqueueJob("poll-github-repos", {});
    res.status(202).json({ enqueued: true, ...result });
  }),
);

/**
 * Clear every lastCommitSha so next poll re-seeds without commit flood.
 */
githubReposRouter.post(
  "/skip-all-backlogs",
  asyncHandler(async (_req, res) => {
    const result = await prisma.githubRepoMonitor.updateMany({
      data: { lastCommitSha: null, lastError: null },
    });
    const job = await enqueueJob("poll-github-repos", {});
    res.json({ ok: true, cleared: result.count, enqueued: true, ...job });
  }),
);

githubReposRouter.post(
  "/:id/run",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.githubRepoMonitor.findUnique({
      where: { id },
    });
    if (!existing) throw new HttpError(404, "not_found");
    const result = await pollGithubRepoMonitor(id, { force: true });
    res.json({ ok: true, ...result });
  }),
);

/**
 * Skip backlog: clear commit watermark, force-poll to re-seed HEAD.
 */
githubReposRouter.post(
  "/:id/skip-backlog",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await prisma.githubRepoMonitor.findUnique({
      where: { id },
    });
    if (!existing) throw new HttpError(404, "not_found");

    await prisma.githubRepoMonitor.update({
      where: { id },
      data: { lastCommitSha: null, lastError: null },
    });

    if (!existing.enabled) {
      res.json({ ok: true, cleared: true, seeded: false, skippedPoll: true });
      return;
    }

    const result = await pollGithubRepoMonitor(id, { force: true });
    res.json({ ok: true, cleared: true, ...result });
  }),
);
