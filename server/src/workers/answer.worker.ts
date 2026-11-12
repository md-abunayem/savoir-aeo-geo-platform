import { Worker, Queue } from "bullmq";
import type { Pool } from "pg";
import { queueConnection } from "../jobs/connection.js";
import {
  processAnswerForRun,
  type ParsedAnswerResult,
} from "../services/answer/answer-pipeline.service.js";

export function createAnswerQueue(redisUrl: string, prefix = "savoir") {
  return new Queue("answer-processing", {
    connection: { ...queueConnection(redisUrl), maxRetriesPerRequest: 1 },
    prefix,
  });
}

export function createAnswerWorker(pool: Pool, redisUrl: string, prefix = "savoir") {
  return new Worker(
    "answer-processing",
    async (job): Promise<ParsedAnswerResult | null> => {
      if (job.name === "parse-answer") {
        const { runId } = job.data as { runId: string };
        if (!runId) throw new Error("Missing runId in parse-answer job");
        return await processAnswerForRun(pool, runId);
      }
      throw new Error(`Unsupported answer job: ${job.name}`);
    },
    { connection: queueConnection(redisUrl), prefix, concurrency: 5 },
  );
}
