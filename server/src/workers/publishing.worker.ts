import "../config/load-env.js";
import { Worker } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import { parseEnvironment } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { createDatabase } from "../db/index.js";
import { queueConnection } from "../jobs/connection.js";
import {
  createPublishingQueue,
  dispatchPublishing,
  PUBLISHING_QUEUE,
  publishingJob,
} from "../jobs/publishing-queue.js";
import { ApprovalService } from "../services/publishing/approval.service.js";
import { PublicMediaService } from "../services/publishing/media.service.js";
import { PublishingProcessor } from "../services/publishing/publishing.processor.js";

async function main() {
  const env = parseEnvironment(process.env);
  if (!env.PUBLISHING_ENABLED) throw new Error("Publishing is disabled");
  const logger = createLogger(env.LOG_LEVEL);
  const { pool } = createDatabase(env.DATABASE_APP_URL!);
  pool.on("error", () => logger.error("publishing database error"));
  const storage = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 3000, requestTimeout: 30000 },
  });
  const service = new ApprovalService(
    pool,
    {
      enabled: true,
      tokenKey: env.PUBLISHING_TOKEN_KEY,
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    },
    new PublicMediaService(storage, {
      bucket: env.S3_PUBLIC_BUCKET,
      privateBucket: env.S3_BUCKET,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL,
    }),
  );
  const processor = new PublishingProcessor(service);
  const queue = createPublishingQueue(env.REDIS_URL);
  const worker = new Worker(
    PUBLISHING_QUEUE,
    async (job) => {
      const value = publishingJob.parse(job.data);
      await processor.process(value.deliveryId, { userId: value.userId, tenantId: value.tenantId });
    },
    {
      connection: queueConnection(env.REDIS_URL),
      concurrency: 3,
      limiter: { max: 20, duration: 60000 },
    },
  );
  queue.on("error", () => logger.error("publishing queue error"));
  worker.on("error", () => logger.error("publishing worker error"));
  worker.on("failed", (job) =>
    logger.error({ jobId: job?.id }, "publishing job failed; reconcile stale dispatch if needed"),
  );
  let scanning = false;
  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try {
      await dispatchPublishing(pool, queue);
    } catch {
      logger.error("publishing outbox scan failed");
    } finally {
      scanning = false;
    }
  };
  const timer = setInterval(() => {
    void scan();
  }, 10000);
  await scan();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const deadline = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    void worker
      .close()
      .then(() => queue.close())
      .then(() => pool.end())
      .finally(() => {
        storage.destroy();
        clearTimeout(deadline);
      });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  logger.info("publishing worker ready");
}
main().catch(() => {
  console.error("Publishing worker startup failed. Check publishing configuration.");
  process.exitCode = 1;
});
