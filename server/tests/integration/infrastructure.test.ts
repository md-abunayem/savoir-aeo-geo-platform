import { createRateLimiter } from "../../src/services/rate-limit.service.js";
import "dotenv/config";
import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { QueueEvents } from "bullmq";
import { parseEnvironment } from "../../src/config/env.js";
import { createLogger } from "../../src/config/logger.js";
import { createInfrastructure } from "../../src/services/infrastructure.service.js";
import { createFoundationQueue } from "../../src/jobs/queues.js";
import { createFoundationWorker } from "../../src/workers/foundation.worker.js";
import { queueConnection } from "../../src/jobs/connection.js";

const env = parseEnvironment(process.env);
const bucket = "savoir-test-" + randomUUID();
const prefix = "test-" + randomUUID();
const infrastructure = createInfrastructure({ ...env, S3_BUCKET: bucket }, createLogger("silent"));
const queue = createFoundationQueue(env.REDIS_URL, prefix);
const worker = createFoundationWorker(env.REDIS_URL, prefix);
const events = new QueueEvents("foundation", {
  connection: queueConnection(env.REDIS_URL),
  prefix,
});
worker.on("error", () => {});
events.on("error", () => {});
queue.on("error", () => {});
let created = false;

beforeAll(async () => {
  await infrastructure.redis.connect();
  await infrastructure.storage.send(new CreateBucketCommand({ Bucket: bucket }));
  created = true;
  await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
});
afterAll(async () => {
  await worker.close();
  await events.close();
  await queue.obliterate({ force: true });
  await queue.close();
  if (created) {
    await infrastructure.storage.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: "tenant-test/evidence.txt" }),
    );
    await infrastructure.storage.send(new DeleteBucketCommand({ Bucket: bucket }));
  }
  await infrastructure.close();
});

describe("real infrastructure using isolated resources", () => {
  it("checks database, Redis and bucket readiness", async () => {
    expect(await infrastructure.readiness()).toEqual({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    });
  });
  it("stores and retrieves evidence", async () => {
    await infrastructure.storage.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: "tenant-test/evidence.txt",
        Body: "savoir-integration-evidence",
      }),
    );
    const result = await infrastructure.storage.send(
      new GetObjectCommand({ Bucket: bucket, Key: "tenant-test/evidence.txt" }),
    );
    expect(await result.Body?.transformToString()).toBe("savoir-integration-evidence");
    const anonymous = await fetch(env.S3_ENDPOINT + "/" + bucket + "/tenant-test/evidence.txt");
    expect([401, 403]).toContain(anonymous.status);
  });
  it("processes one idempotent queue job", async () => {
    const job = await queue.add("ping", {}, { jobId: "same-logical-job" });
    expect(await job.waitUntilFinished(events, 10000)).toEqual({ ok: true });
    const duplicate = await queue.add("ping", {}, { jobId: "same-logical-job" });
    expect(duplicate.id).toBe(job.id);
    expect(await queue.getCompletedCount()).toBe(1);
  });
});

it("atomically limits authentication attempts in Redis with a TTL", async () => {
  const limiter = createRateLimiter(infrastructure.redis, prefix + ":auth");
  const key = "test-account";
  const storageKey = prefix + ":auth:" + createHash("sha256").update(key).digest("hex");
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => limiter.consume(key, 3, 30)));
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(results.every((result) => result.retryAfter > 0 && result.retryAfter <= 30)).toBe(true);
  } finally {
    await infrastructure.redis.del(storageKey);
  }
});
