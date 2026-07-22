// Enqueue helper — validate a payload against the job contract and push it onto
// the correct queue with the correct BullMQ job name. This is the one path
// through which the backend triggers work in the running early-alpha system.

import { getQueue } from "./services/queue.js";
import { JOBS, type JobName } from "./jobs.js";

export interface EnqueueResult {
  job: JobName;
  jobId: string | undefined;
  queue: string;
  existing: boolean;
  /** True when jobId collided and an older job is still on the queue. */
  deduped?: boolean;
}

/**
 * Validate `payload` against the named job's schema and enqueue it. Throws a
 * ZodError (surfaced as 400 by the error middleware) on bad payloads.
 *
 * `opts.jobId` — stable id (e.g. early-tl-accountId; no ":" — BullMQ forbids it).
 * `opts.delay` — ms before job becomes active (rate-limit backoff).
 */
export async function enqueueJob(
  name: JobName,
  payload: unknown,
  opts?: { jobId?: string; delay?: number },
): Promise<EnqueueResult> {
  const jobDef = JOBS[name];
  const data = jobDef.schema.parse(payload ?? {});
  const queue = getQueue(jobDef.queue);
  try {
    const job = await queue.add(jobDef.jobName, data, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...(opts?.jobId ? { jobId: opts.jobId } : {}),
      ...(opts?.delay != null && opts.delay > 0 ? { delay: opts.delay } : {}),
    });
    return {
      job: name,
      jobId: job.id,
      queue: jobDef.queue,
      existing: jobDef.existing,
    };
  } catch (err) {
    // BullMQ: duplicate jobId while job still exists
    if (opts?.jobId) {
      const existingJob = await queue.getJob(opts.jobId).catch(() => null);
      if (existingJob) {
        const state = await existingJob.getState().catch(() => "unknown");
        // Refresh payload if waiting/delayed so newest lastTweetId wins
        if (state === "waiting" || state === "delayed") {
          await existingJob.updateData(data).catch(() => undefined);
          if (opts.delay != null && opts.delay > 0) {
            await existingJob.changeDelay(opts.delay).catch(() => undefined);
          }
        }
        return {
          job: name,
          jobId: existingJob.id,
          queue: jobDef.queue,
          existing: jobDef.existing,
          deduped: true,
        };
      }
    }
    throw err;
  }
}
