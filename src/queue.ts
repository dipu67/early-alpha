// BullMQ queues — the backend's OWN Queue handles on the SAME Redis / queue
// names that early-alpha's workers already consume. Enqueuing here means the
// running early-alpha worker picks the job up. The backend never runs a Worker
// and never touches Twitter in-process.

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";

export const connection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

/** Queue names, mirroring early-alpha's services/queue.ts. */
export type QueueName = "follow-tracker" | "seed-tracker" | "list-tracker";

const queues = new Map<QueueName, Queue>();

/** Lazily construct (and cache) a Queue handle for a name. */
export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection });
    queues.set(name, q);
  }
  return q;
}
