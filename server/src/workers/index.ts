import "dotenv/config";
import { parseEnvironment } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { createFoundationWorker } from "./foundation.worker.js";

const env = parseEnvironment(process.env);
const logger = createLogger(env.LOG_LEVEL);
const worker = createFoundationWorker(env.REDIS_URL);
worker.on("error", () => logger.error("worker connection error"));
worker.on("failed", (job) => logger.error({ jobId: job?.id }, "job failed"));
worker.on("ready", () => logger.info("foundation worker ready"));
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
  deadline.unref();
  void worker
    .close()
    .then(() => {
      clearTimeout(deadline);
    })
    .catch(() => {
      process.exitCode = 1;
    });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
