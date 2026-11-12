import type { Pool } from "pg";
import { Queue } from "bullmq";
import { z } from "zod";
import { queueConnection } from "./connection.js";
export const PUBLISHING_QUEUE = "publishing-queue";
export const publishingJob = z
  .object({ deliveryId: z.uuid(), userId: z.uuid(), tenantId: z.uuid() })
  .strict();
export function createPublishingQueue(redisUrl: string) {
  return new Queue(PUBLISHING_QUEUE, {
    connection: {
      ...queueConnection(redisUrl),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    },
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    },
  });
}
export async function dispatchPublishing(pool: Pool, queue: Queue) {
  const due = await pool.query<{
    id: string;
    user_id: string;
    tenant_id: string;
    attempts: number;
    due_at: Date;
  }>("SELECT * FROM savoir_publishing_due()");
  for (const item of due.rows) {
    const data = publishingJob.parse({
      deliveryId: item.id,
      userId: item.user_id,
      tenantId: item.tenant_id,
    });
    const jobId = `delivery-${item.id}-${item.attempts}-${new Date(item.due_at).getTime()}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== "failed" && state !== "completed") continue;
      await existing.remove();
    }
    await queue.add("publish", data, {
      jobId,
      delay: Math.max(0, new Date(item.due_at).getTime() - Date.now()),
      attempts: 1,
    });
  }
}
