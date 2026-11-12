import { createMonitoringNotifier } from "../services/monitoring/notifications.js";
import "../config/load-env.js";
import { Queue, Worker } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import { parseEnvironment } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { createDatabase } from "../db/index.js";
import { queueConnection } from "../jobs/connection.js";
import { createMonitoringEvidence } from "../services/monitoring/evidence.js";
import { createMonitoringProcessor } from "../services/monitoring/processor.js";
import { createGeminiProvider } from "../services/monitoring/gemini.adapter.js";
import { createOpenRouterProvider } from "../services/monitoring/openrouter.adapter.js";
import { createOpenAIProvider } from "../services/monitoring/openai.adapter.js";
import { createSerpProvider } from "../services/monitoring/serp.adapter.js";
import { createMultiEngineProvider } from "../services/monitoring/multi-engine.provider.js";
import {
  MONITORING_REQUEST_QUEUE,
  dispatchMonitoringRequests,
  executeMonitoringRequest,
} from "../jobs/monitoring-queue.js";
import { createCredentialPreflight } from "../services/monitoring/credential-preflight.js";
async function main() {
  const env = parseEnvironment(process.env);
  if (!env.MONITORING_ENABLED) throw new Error("Monitoring disabled");
  const logger = createLogger(env.LOG_LEVEL);
  const { pool } = createDatabase(env.DATABASE_APP_URL ?? "");
  pool.on("error", () => logger.error("monitoring database error"));
  try {
    const r = await pool.query(
      "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
    );
    if (!r.rows[0] || Object.values(r.rows[0]).some(Boolean))
      throw new Error("Restricted runtime role required");
  } catch (error) {
    await pool.end();
    throw error;
  }
  const storage = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    forcePathStyle: true,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 },
  });
  const provider = createMultiEngineProvider({
    ...(env.OPENROUTER_API_KEY
      ? {
          openrouter: createOpenRouterProvider({
            apiKey: env.OPENROUTER_API_KEY,
            maxOutputTokens: env.OPENROUTER_MAX_OUTPUT_TOKENS,
          }),
        }
      : {}),
    ...(env.GEMINI_API_KEY
      ? {
          gemini: createGeminiProvider({
            apiKey: env.GEMINI_API_KEY,
            maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS,
            inputUsdPerMillion: env.GEMINI_INPUT_USD_PER_MILLION,
            outputUsdPerMillion: env.GEMINI_OUTPUT_USD_PER_MILLION,
          }),
        }
      : {}),
    ...(env.OPENAI_API_KEY
      ? {
          openai: createOpenAIProvider({
            apiKey: env.OPENAI_API_KEY,
            maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
            inputUsdPerMillion: env.OPENAI_INPUT_USD_PER_MILLION,
            outputUsdPerMillion: env.OPENAI_OUTPUT_USD_PER_MILLION,
          }),
        }
      : {}),
    ...(env.SERP_PROVIDER_API_KEY
      ? {
          google_ai_overviews: createSerpProvider({
            apiKey: env.SERP_PROVIDER_API_KEY,
            baseUrl: env.SERP_PROVIDER_BASE_URL,
            costPerCallUsd: env.SERP_COST_PER_CALL_USD,
          }),
        }
      : {}),
  });
  logger.info(
    { configuredEngines: provider.configuredEngines() },
    "Monitoring provider configuration loaded; restart after credential changes",
  );
  const processor = createMonitoringProcessor(
    pool,
    provider,
    createMonitoringEvidence(storage, env.S3_BUCKET),
    {
      dailyLimit: env.MONITORING_DAILY_CALL_LIMIT,
      spacingSeconds: env.MONITORING_CALL_SPACING_SECONDS,
      onFailure: (details) => logger.warn(details, "monitoring provider execution failed"),
    },
  );
  const notifier = createMonitoringNotifier(pool, env.EMAIL_PAYLOAD_KEY ?? "");
  const connection = queueConnection(env.REDIS_URL);
  const queue = new Queue("monitoring", {
    connection: { ...connection, maxRetriesPerRequest: 1 },
  });
  const requests = new Queue(MONITORING_REQUEST_QUEUE, {
    connection: { ...connection, maxRetriesPerRequest: 1 },
  });
  const check = createCredentialPreflight({
    gemini: env.GEMINI_API_KEY
      ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }
      : undefined,
    openrouter: env.OPENROUTER_API_KEY
      ? { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL }
      : undefined,
    openai: env.OPENAI_API_KEY
      ? { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }
      : undefined,
    serpApiKey: env.SERP_PROVIDER_API_KEY,
  });
  // Global concurrency/limiter also coordinate multiple worker processes.
  queue.on("error", () => logger.error("monitoring queue error"));
  requests.on("error", () => logger.error("monitoring request queue error"));
  try {
    await requests.setGlobalConcurrency(1);
  } catch (error) {
    await Promise.allSettled([queue.close(), requests.close(), pool.end()]);
    storage.destroy();
    throw error;
  }
  const requestWorker = new Worker(
    MONITORING_REQUEST_QUEUE,
    async (job) => {
      if (job.name !== "monitoring-request") throw new Error("Unsupported request job");
      return executeMonitoringRequest(job.data, { pool, check, processRun: processor.processRun });
    },
    {
      connection,
      concurrency: 1,
      maxStalledCount: 0,
      limiter: { max: 1, duration: env.MONITORING_CALL_SPACING_SECONDS * 1000 },
    },
  );
  const worker = new Worker(
    "monitoring",
    async (job) => {
      if (job.name !== "monitoring-tick") throw new Error("Unsupported monitoring job");
      await processor.tick();
      await notifier.drain();
      await dispatchMonitoringRequests(
        pool,
        requests,
        env.MONITORING_DAILY_CALL_LIMIT,
        Date.now(),
        check,
      );
    },
    { connection, concurrency: 1 },
  );
  requestWorker.on("error", () => logger.error("monitoring request worker error"));
  requestWorker.on("failed", (job) =>
    logger.error({ jobId: job?.id }, "monitoring request job failed"),
  );
  requestWorker.on("stalled", (jobId) =>
    logger.warn(
      { jobId },
      "monitoring request stalled; database lease prevents duplicate provider calls",
    ),
  );
  worker.on("error", () => logger.error("monitoring worker error"));
  worker.on("failed", (job) => logger.error({ jobId: job?.id }, "monitoring processing failed"));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    void Promise.all([worker.close(), requestWorker.close()])
      .then(() => Promise.all([queue.close(), requests.close()]))
      .then(() => {
        storage.destroy();
        return pool.end();
      })
      .then(() => clearTimeout(deadline))
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await queue.upsertJobScheduler(
      "monitoring-poll",
      { every: 5000 },
      {
        name: "monitoring-tick",
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
          removeOnComplete: { count: 20 },
          removeOnFail: { count: 100 },
        },
      },
    );
    logger.info("Monitoring dispatcher and throttled request worker started");
  } catch {
    logger.error("monitoring scheduler startup failed");
    stop();
  }
}
main().catch((error: unknown) => {
  const details =
    error instanceof Error
      ? {
          name: error.name,
          code: "code" in error && typeof error.code === "string" ? error.code : undefined,
          message: error.message
            .replace(/(postgres(?:ql)?|redis(?:s)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@")
            .replace(/\bsk-(?:or-v1-)?[A-Za-z0-9_-]+\b/g, "[REDACTED]"),
        }
      : { name: typeof error };
  console.error("Monitoring worker cannot start:", details);
  process.exitCode = 1;
});
