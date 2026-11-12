import { Queue } from "bullmq";
import { queueConnection } from "./connection.js";

export function createFoundationQueue(redisUrl: string, prefix = "savoir") {
  return new Queue("foundation", {
    connection: { ...queueConnection(redisUrl), maxRetriesPerRequest: 1 },
    prefix,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
      removeOnComplete: { count: 100, age: 86400 },
      removeOnFail: { count: 1000, age: 604800 },
    },
  });
}
