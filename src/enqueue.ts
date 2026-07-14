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
}

/**
 * Validate `payload` against the named job's schema and enqueue it. Throws a
 * ZodError (surfaced as 400 by the error middleware) on bad payloads.
 */
export async function enqueueJob(name: JobName, payload: unknown): Promise<EnqueueResult> {
  const jobDef = JOBS[name];
  const data = jobDef.schema.parse(payload ?? {});
  const queue = getQueue(jobDef.queue);
  const job = await queue.add(jobDef.jobName, data, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
  return {
    job: name,
    jobId: job.id,
    queue: jobDef.queue,
    existing: jobDef.existing,
  };
}
