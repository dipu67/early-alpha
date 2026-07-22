// Scheduler registry — mirror of services/queue.ts SCHEDULERS on the backend
// side. The backend uses this to list schedulers and to re-upsert / remove them
// on the shared Redis (the running worker consumes whatever is scheduled).

export interface SchedulerDef {
  key: string;
  queue: "seed-tracker" | "list-tracker";
  schedulerId: string;
  jobName: string;
  data: Record<string, unknown>;
  defaultEvery?: number;
  defaultCron?: string;
  label: string;
}

export const SCHEDULERS: SchedulerDef[] = [
  { key: "seed-track", queue: "seed-tracker", schedulerId: "seed-track-cycle", jobName: "track-seeds", data: { fullSync: false }, defaultEvery: 15 * 60 * 1000, label: "Seed tracking cycle" },
  { key: "seed-full-sync", queue: "seed-tracker", schedulerId: "seed-full-sync", jobName: "track-seeds", data: { fullSync: true }, defaultCron: "0 3 * * *", label: "Daily full sync" },
  { key: "daily-digest", queue: "seed-tracker", schedulerId: "daily-digest", jobName: "daily-digest", data: {}, defaultCron: "0 9 * * *", label: "Daily digest" },
  { key: "health-check", queue: "seed-tracker", schedulerId: "health-check", jobName: "health-check", data: {}, defaultEvery: 6 * 60 * 60 * 1000, label: "Health check" },
  { key: "early-digest", queue: "list-tracker", schedulerId: "early-digest", jobName: "early-digest", data: {}, defaultCron: "0 9,21 * * *", label: "Early-project digest (09:00 & 21:00 UTC)" },
  { key: "search-poll", queue: "list-tracker", schedulerId: "search-poll", jobName: "poll-searches", data: {}, defaultEvery: 60 * 1000, label: "Twitter search poll" },
  { key: "list-monitor-poll", queue: "list-tracker", schedulerId: "list-monitor-poll", jobName: "poll-list-monitors", data: {}, defaultEvery: 60 * 1000, label: "Public Twitter list monitors" },
  { key: "chainlist-poll", queue: "list-tracker", schedulerId: "chainlist-poll", jobName: "poll-chainlist", data: {}, defaultEvery: 60 * 60 * 1000, label: "New chains (rpcs.json + GitHub registry)" },
  { key: "github-repo-poll", queue: "list-tracker", schedulerId: "github-repo-poll", jobName: "poll-github-repos", data: {}, defaultEvery: 5 * 60 * 1000, label: "GitHub repo commit monitors" },
  { key: "monitor-poll", queue: "list-tracker", schedulerId: "monitor-poll", jobName: "poll-monitors", data: {}, defaultEvery: 2 * 60 * 1000, label: "User timeline monitors" },
  { key: "early-project-poll", queue: "list-tracker", schedulerId: "early-project-poll", jobName: "poll-early-projects", data: {}, defaultEvery: 60 * 60 * 1000, label: "Early projects usersByIds (1h)" },
  { key: "growth-report", queue: "list-tracker", schedulerId: "growth-report", jobName: "growth-report", data: {}, defaultCron: "0 10 * * 1", label: "Weekly top growing projects (Mon 10:00 UTC)" },
];

export function getScheduler(key: string): SchedulerDef | undefined {
  return SCHEDULERS.find((s) => s.key === key);
}
