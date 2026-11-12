import { PutObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { EvidenceStore } from "./types.js";
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export function createMonitoringEvidence(storage: S3Client, bucket: string): EvidenceStore {
  const valid = (key: string) => {
    if (!/^monitoring\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.json$/.test(key))
      throw new Error("Invalid evidence key");
  };
  return {
    async put(key, value) {
      valid(key);
      if (Buffer.byteLength(value, "utf8") > MAX_EVIDENCE_BYTES)
        throw new Error("Evidence exceeds 5 MiB upload limit");
      try {
        await storage.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: value,
            ContentType: "application/json",
            IfNoneMatch: "*",
          }),
        );
      } catch {
        throw new Error("Evidence upload failed; check private bucket access and S3 connection");
      }
    },
    async get(key) {
      valid(key);
      try {
        const response = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return (await response.Body?.transformToString()) ?? "";
      } catch {
        throw new Error("Evidence retrieval failed; check private bucket access and S3 connection");
      }
    },
  };
}
