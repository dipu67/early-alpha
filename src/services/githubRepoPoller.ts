// GitHub repo commit monitor.
//
// Per monitor:
//   1. GET /repos/{owner}/{repo}/commits?sha=branch&path=pathFilter
//   2. If lastCommitSha empty → seed watermark only (no Telegram flood)
//   3. Else collect commits newer than watermark
//   4. Optionally load commit file list for detail
//   5. Save GithubRepoCommit + Telegram alert
//   6. Advance lastCommitSha to newest

import { prisma } from "../db/prisma.js";
import { sendTelegramAlert, isAlertEnabled } from "../tg/sendAlert.js";
import { formatGithubCommitAlert } from "./formatAlert.js";

const GITHUB_API = "https://api.github.com";
const COMMITS_PER_POLL = Math.max(
  5,
  Math.min(50, Number(process.env.GITHUB_REPO_POLL_COUNT ?? 20)),
);
const COMMIT_HIT_KEEP = Math.max(
  1,
  Number(process.env.GITHUB_REPO_HIT_KEEP ?? 50),
);

const DEFAULT_CHAINLIST = {
  owner: "DefiLlama",
  repo: "chainlist",
  label: "Chainlist · additionalChainRegistry",
  pathFilter: "constants/additionalChainRegistry",
  branch: "main",
  intervalSec: 300,
} as const;

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "early-alpha-github-monitor/1.0",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function ghJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub ${res.status} ${url.replace(GITHUB_API, "")}: ${body.slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

export function parseGithubRepoInput(raw: string): {
  owner: string;
  repo: string;
} | null {
  const s = raw.trim().replace(/\/+$/, "");
  if (!s) return null;

  // owner/repo
  const simple = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (simple) return { owner: simple[1]!, repo: simple[2]! };

  // https://github.com/owner/repo[/...]
  const url = s.match(
    /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i,
  );
  if (url) return { owner: url[1]!, repo: url[2]! };

  return null;
}

interface GhCommitListItem {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string; date?: string } | null;
    committer?: { name?: string; date?: string } | null;
  };
  author?: { login?: string } | null;
}

interface GhCommitDetail {
  sha: string;
  html_url: string;
  commit: GhCommitListItem["commit"];
  author?: { login?: string } | null;
  files?: {
    filename: string;
    status: string;
  }[];
}

interface GhRepoMeta {
  full_name: string;
  description: string | null;
  default_branch: string;
}

async function fetchCommits(
  owner: string,
  repo: string,
  branch: string,
  pathFilter: string | null,
  perPage: number,
): Promise<GhCommitListItem[]> {
  const params = new URLSearchParams({
    sha: branch,
    per_page: String(perPage),
  });
  if (pathFilter?.trim()) params.set("path", pathFilter.trim());
  const url = `${GITHUB_API}/repos/${owner}/${repo}/commits?${params}`;
  return ghJson<GhCommitListItem[]>(url);
}

async function fetchCommitDetail(
  owner: string,
  repo: string,
  sha: string,
): Promise<GhCommitDetail> {
  return ghJson<GhCommitDetail>(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}`,
  );
}

async function fetchRepoMeta(
  owner: string,
  repo: string,
): Promise<GhRepoMeta | null> {
  try {
    return await ghJson<GhRepoMeta>(`${GITHUB_API}/repos/${owner}/${repo}`);
  } catch {
    return null;
  }
}

function filesByStatus(
  files: { filename: string; status: string }[] | undefined,
): { added: string[]; modified: string[]; removed: string[] } {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const f of files ?? []) {
    if (f.status === "added") added.push(f.filename);
    else if (f.status === "removed") removed.push(f.filename);
    else modified.push(f.filename);
  }
  // Cap paths stored
  return {
    added: added.slice(0, 40),
    modified: modified.slice(0, 40),
    removed: removed.slice(0, 40),
  };
}

async function pruneOldCommits(monitorId: bigint): Promise<void> {
  const keep = await prisma.githubRepoCommit.findMany({
    where: { monitorId },
    orderBy: { createdAt: "desc" },
    take: COMMIT_HIT_KEEP,
    select: { id: true },
  });
  if (keep.length < COMMIT_HIT_KEEP) return;
  const keepIds = keep.map((k) => k.id);
  await prisma.githubRepoCommit.deleteMany({
    where: { monitorId, id: { notIn: keepIds } },
  });
}

async function sendCommitAlert(
  monitor: {
    fullName: string;
    label: string | null;
    pathFilter: string | null;
    topicId: number | null;
    alertEnabled: boolean;
  },
  commit: {
    sha: string;
    message: string;
    authorName: string | null;
    authorLogin: string | null;
    htmlUrl: string;
    filesAdded: string[];
    filesModified: string[];
    filesRemoved: string[];
  },
): Promise<boolean> {
  if (!monitor.alertEnabled) return false;
  if (!(await isAlertEnabled("githubRepo"))) return false;

  const msg = formatGithubCommitAlert({
    fullName: monitor.fullName,
    label: monitor.label,
    pathFilter: monitor.pathFilter,
    sha: commit.sha,
    message: commit.message,
    authorName: commit.authorName,
    authorLogin: commit.authorLogin,
    htmlUrl: commit.htmlUrl,
    filesAdded: commit.filesAdded,
    filesModified: commit.filesModified,
    filesRemoved: commit.filesRemoved,
  });

  await sendTelegramAlert(
    msg,
    "MarkdownV2",
    monitor.topicId ?? undefined,
    "githubRepo",
  );
  return true;
}

export type GithubPollResult = {
  monitorId: string;
  fullName: string;
  seeded?: boolean;
  newCommits: number;
  alerted: number;
  skipped?: boolean;
  error?: string;
};

/**
 * Poll one monitor. `force` ignores interval.
 */
export async function pollGithubRepoMonitor(
  monitorId: bigint,
  opts?: { force?: boolean },
): Promise<GithubPollResult> {
  const row = await prisma.githubRepoMonitor.findUnique({
    where: { id: monitorId },
  });
  if (!row) {
    return {
      monitorId: monitorId.toString(),
      fullName: "?",
      newCommits: 0,
      alerted: 0,
      error: "not_found",
    };
  }
  if (!row.enabled && !opts?.force) {
    return {
      monitorId: row.id.toString(),
      fullName: row.fullName,
      newCommits: 0,
      alerted: 0,
      skipped: true,
    };
  }

  if (!opts?.force && row.lastPolledAt) {
    const due =
      row.lastPolledAt.getTime() + row.intervalSec * 1000 <= Date.now();
    if (!due) {
      return {
        monitorId: row.id.toString(),
        fullName: row.fullName,
        newCommits: 0,
        alerted: 0,
        skipped: true,
      };
    }
  }

  try {
    const commits = await fetchCommits(
      row.owner,
      row.repo,
      row.branch,
      row.pathFilter,
      COMMITS_PER_POLL,
    );

    if (commits.length === 0) {
      await prisma.githubRepoMonitor.update({
        where: { id: row.id },
        data: { lastPolledAt: new Date(), lastError: null },
      });
      return {
        monitorId: row.id.toString(),
        fullName: row.fullName,
        newCommits: 0,
        alerted: 0,
      };
    }

    const newest = commits[0]!;
    const isSeed = !row.lastCommitSha;

    if (isSeed) {
      await prisma.githubRepoMonitor.update({
        where: { id: row.id },
        data: {
          lastPolledAt: new Date(),
          lastCommitSha: newest.sha,
          lastError: null,
        },
      });
      console.log(
        `[github-repo] seeded ${row.fullName} @ ${newest.sha.slice(0, 7)} (no alerts)`,
      );
      return {
        monitorId: row.id.toString(),
        fullName: row.fullName,
        seeded: true,
        newCommits: 0,
        alerted: 0,
      };
    }

    // Collect new commits until watermark (API returns newest first)
    const fresh: GhCommitListItem[] = [];
    for (const c of commits) {
      if (c.sha === row.lastCommitSha) break;
      fresh.push(c);
    }

    // If watermark not in page, treat entire page as new (gap) — still OK
    // Process oldest → newest so alerts are chronological
    fresh.reverse();

    let alerted = 0;
    let saved = 0;

    for (const c of fresh) {
      let files = {
        added: [] as string[],
        modified: [] as string[],
        removed: [] as string[],
      };
      try {
        const detail = await fetchCommitDetail(row.owner, row.repo, c.sha);
        files = filesByStatus(detail.files);
      } catch (err) {
        console.warn(
          `[github-repo] commit detail ${c.sha.slice(0, 7)}:`,
          err instanceof Error ? err.message : err,
        );
      }

      const message = (c.commit?.message ?? "").split("\n")[0] ?? "";
      const authorName =
        c.commit?.author?.name ?? c.commit?.committer?.name ?? null;
      const authorLogin = c.author?.login ?? null;
      const committedAtRaw =
        c.commit?.committer?.date ?? c.commit?.author?.date ?? null;
      const committedAt = committedAtRaw ? new Date(committedAtRaw) : null;

      const payload = {
        sha: c.sha,
        message,
        authorName,
        authorLogin,
        htmlUrl: c.html_url,
        filesAdded: files.added,
        filesModified: files.modified,
        filesRemoved: files.removed,
      };

      let didAlert = false;
      try {
        didAlert = await sendCommitAlert(row, payload);
        if (didAlert) alerted += 1;
      } catch (err) {
        console.error(
          `[github-repo] alert failed ${row.fullName} ${c.sha.slice(0, 7)}:`,
          err instanceof Error ? err.message : err,
        );
      }

      try {
        await prisma.githubRepoCommit.upsert({
          where: {
            monitorId_sha: { monitorId: row.id, sha: c.sha },
          },
          create: {
            monitorId: row.id,
            sha: c.sha,
            message,
            authorName,
            authorLogin,
            htmlUrl: c.html_url,
            committedAt:
              committedAt && !Number.isNaN(committedAt.getTime())
                ? committedAt
                : null,
            filesAdded: files.added,
            filesModified: files.modified,
            filesRemoved: files.removed,
            alerted: didAlert,
          },
          update: {
            alerted: didAlert,
            filesAdded: files.added,
            filesModified: files.modified,
            filesRemoved: files.removed,
          },
        });
        saved += 1;
      } catch (err) {
        console.error(
          `[github-repo] save commit failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    await prisma.githubRepoMonitor.update({
      where: { id: row.id },
      data: {
        lastPolledAt: new Date(),
        lastCommitSha: newest.sha,
        lastError: null,
        hitCount: { increment: saved },
      },
    });
    await pruneOldCommits(row.id);

    console.log(
      `[github-repo] ${row.fullName} new=${fresh.length} alerted=${alerted} head=${newest.sha.slice(0, 7)}`,
    );

    return {
      monitorId: row.id.toString(),
      fullName: row.fullName,
      newCommits: fresh.length,
      alerted,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.githubRepoMonitor.update({
      where: { id: row.id },
      data: {
        lastPolledAt: new Date(),
        lastError: msg.slice(0, 500),
      },
    });
    console.error(`[github-repo] poll ${row.fullName} failed:`, msg);
    return {
      monitorId: row.id.toString(),
      fullName: row.fullName,
      newCommits: 0,
      alerted: 0,
      error: msg,
    };
  }
}

export async function pollAllGithubRepoMonitors(): Promise<{
  polled: number;
  results: GithubPollResult[];
}> {
  // Ensure default chainlist monitor exists
  await ensureDefaultGithubRepos();

  const rows = await prisma.githubRepoMonitor.findMany({
    where: { enabled: true },
    orderBy: { id: "asc" },
  });

  const results: GithubPollResult[] = [];
  for (const r of rows) {
    results.push(await pollGithubRepoMonitor(r.id));
  }
  return { polled: results.filter((r) => !r.skipped).length, results };
}

/**
 * Seed DefiLlama/chainlist (additionalChainRegistry path) if missing.
 */
export async function ensureDefaultGithubRepos(): Promise<{
  created: boolean;
  monitorId: string;
}> {
  const fullName = `${DEFAULT_CHAINLIST.owner}/${DEFAULT_CHAINLIST.repo}`;
  const existing = await prisma.githubRepoMonitor.findUnique({
    where: { fullName },
  });
  if (existing) {
    return { created: false, monitorId: existing.id.toString() };
  }

  const meta = await fetchRepoMeta(
    DEFAULT_CHAINLIST.owner,
    DEFAULT_CHAINLIST.repo,
  );

  const row = await prisma.githubRepoMonitor.create({
    data: {
      owner: DEFAULT_CHAINLIST.owner,
      repo: DEFAULT_CHAINLIST.repo,
      fullName,
      label: DEFAULT_CHAINLIST.label,
      description: meta?.description ?? "DefiLlama chainlist — new EVM chains",
      branch: meta?.default_branch ?? DEFAULT_CHAINLIST.branch,
      pathFilter: DEFAULT_CHAINLIST.pathFilter,
      intervalSec: DEFAULT_CHAINLIST.intervalSec,
      enabled: true,
      alertEnabled: true,
    },
  });

  console.log(
    `[github-repo] seeded default monitor ${fullName} path=${DEFAULT_CHAINLIST.pathFilter}`,
  );
  return { created: true, monitorId: row.id.toString() };
}

/** Create monitor after validating repo exists on GitHub. */
export async function createGithubRepoMonitor(input: {
  owner: string;
  repo: string;
  label?: string | null;
  pathFilter?: string | null;
  branch?: string | null;
  topicId?: number | null;
  intervalSec?: number;
  alertEnabled?: boolean;
  enabled?: boolean;
}) {
  const fullName = `${input.owner}/${input.repo}`;
  const meta = await fetchRepoMeta(input.owner, input.repo);
  if (!meta) {
    throw new Error("repo_not_found");
  }

  return prisma.githubRepoMonitor.create({
    data: {
      owner: input.owner,
      repo: input.repo,
      fullName,
      label: input.label?.trim() || null,
      description: meta.description,
      branch: input.branch?.trim() || meta.default_branch || "main",
      pathFilter: input.pathFilter?.trim() || null,
      topicId: input.topicId ?? null,
      intervalSec: Math.max(60, Math.min(86_400, input.intervalSec ?? 300)),
      alertEnabled: input.alertEnabled ?? true,
      enabled: input.enabled ?? true,
    },
  });
}
