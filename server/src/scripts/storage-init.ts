import "dotenv/config";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { parseEnvironment } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { createInfrastructure } from "../services/infrastructure.service.js";

async function initializeStorage() {
  const env = parseEnvironment(process.env);
  const logger = createLogger(env.LOG_LEVEL);
  const infrastructure = createInfrastructure(env, logger);
  try {
    await infrastructure.storage.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    logger.info("Private evidence bucket is accessible");
  } finally {
    await infrastructure.close();
  }
}
initializeStorage().catch(() => {
  console.error(
    "Storage initialization failed; check credentials, endpoint and bucket configuration.",
  );
  process.exitCode = 1;
});
