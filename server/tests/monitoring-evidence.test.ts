import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  createMonitoringEvidence,
  MAX_EVIDENCE_BYTES,
} from "../src/services/monitoring/evidence.js";

it("rejects oversized evidence before uploading", async () => {
  const send = vi.fn();
  const store = createMonitoringEvidence({ send } as unknown as S3Client, "aeo-evidence");
  const key = `monitoring/${randomUUID()}/${randomUUID()}/${randomUUID()}/${randomUUID()}.json`;
  await expect(store.put(key, "x".repeat(MAX_EVIDENCE_BYTES + 1))).rejects.toThrow("5 MiB");
  expect(send).not.toHaveBeenCalled();
});
