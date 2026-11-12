import { Worker } from "bullmq";
import { queueConnection } from "../jobs/connection.js";

export function createFoundationWorker(redisUrl: string, prefix = "savoir") {
  return new Worker(
    "foundation",
    async (job) => {
      if (job.name !== "ping") throw new Error("Unsupported foundation job");
      return { ok: true };
    },
    { connection: queueConnection(redisUrl), prefix, concurrency: 1 },
  );
}
