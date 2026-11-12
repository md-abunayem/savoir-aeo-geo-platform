import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { it, expect } from "vitest";
import { createMonitoringEvidence } from "../../src/services/monitoring/evidence.js";
it("writes monitoring evidence once to a private local object and reads it back", async () => {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint || !["localhost", "127.0.0.1", "minio"].includes(new URL(endpoint).hostname))
    throw new Error("Local storage required");
  const storage = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    maxAttempts: 1,
  });
  const bucket = "savoir-monitor-test-" + randomUUID();
  const key = `monitoring/${randomUUID()}/${randomUUID()}/${randomUUID()}/${randomUUID()}.json`;
  let created = false;
  try {
    await storage.send(new CreateBucketCommand({ Bucket: bucket }));
    created = true;
    const evidence = createMonitoringEvidence(storage, bucket);
    await evidence.put(key, '{"answer":"original"}');
    await expect(evidence.put(key, '{"answer":"overwrite"}')).rejects.toThrow();
    expect(await evidence.get(key)).toBe('{"answer":"original"}');
    await expect(evidence.get("other-tenant/arbitrary")).rejects.toThrow("Invalid evidence key");
  } finally {
    if (created) {
      await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      await storage.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    storage.destroy();
  }
});
