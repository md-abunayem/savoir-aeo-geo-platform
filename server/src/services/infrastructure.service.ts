import { Redis } from "ioredis";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import type { Environment } from "../config/env.js";
import type { Logger } from "pino";
import { createDatabase } from "../db/index.js";

export type Readiness = {
  ready: boolean;
  checks: Record<"database" | "redis" | "storage", "up" | "down">;
};

export function createInfrastructure(env: Environment, logger: Logger) {
  const { pool, db } = createDatabase(env.DATABASE_APP_URL ?? env.DATABASE_URL ?? "");
  pool.on("error", () => logger.error({ component: "database" }, "database connection error"));
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 3000,
    enableOfflineQueue: false,
  });
  redis.on("error", () => logger.warn({ component: "redis" }, "redis connection error"));
  const storage = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    forcePathStyle: true,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 3000 },
  });
  // Presigned browser PUTs have no body at signing time. Avoid an SDK-generated
  // empty-body CRC32 checksum that would reject the actual uploaded file.
  const publicStorage = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 30000 },
  });

  async function readiness(): Promise<Readiness> {
    const results = await Promise.allSettled([
      pool.query("SELECT 1"),
      redis.ping(),
      storage.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), {
        abortSignal: AbortSignal.timeout(3500),
      }),
    ]);
    const checks = {
      database: results[0].status === "fulfilled" ? "up" : "down",
      redis: results[1].status === "fulfilled" ? "up" : "down",
      storage: results[2].status === "fulfilled" ? "up" : "down",
    } as const;
    return { ready: results.every((result) => result.status === "fulfilled"), checks };
  }

  async function close() {
    redis.disconnect();
    storage.destroy();
    publicStorage.destroy();
    await pool.end();
  }
  return { pool, db, redis, storage, publicStorage, readiness, close };
}
