import { describe, expect, it, vi } from "vitest";
import { PublicMediaService } from "../src/services/publishing/media.service.js";
import { S3Client } from "@aws-sdk/client-s3";
describe("public media isolation and finalization", () => {
  it("presigns real browser upload bytes without signing an empty-body checksum", async () => {
    const storage = new S3Client({
      region: "us-east-1",
      endpoint: "https://storage.example",
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    try {
      const service = new PublicMediaService(storage, {
        bucket: "media",
        privateBucket: "evidence",
        publicBaseUrl: "https://media.example",
      });
      const upload = await service.prepare("project", { mimeType: "image/png", sizeBytes: 100 });
      const url = new URL(upload.uploadUrl);
      expect(url.pathname).toContain("/pending/project/");
      expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
      expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
      expect(upload.publicUrl).not.toContain("pending/");
    } finally {
      storage.destroy();
    }
  });
  it("refuses using the private evidence bucket for public media", async () => {
    const storage = { send: vi.fn() };
    const service = new PublicMediaService(storage as never, {
      bucket: "evidence",
      privateBucket: "evidence",
      publicBaseUrl: "https://media.example",
    });
    await expect(
      service.prepare("project", { mimeType: "image/png", sizeBytes: 100 }),
    ).rejects.toMatchObject({ code: "PUBLIC_MEDIA_NOT_CONFIGURED" });
    expect(storage.send).not.toHaveBeenCalled();
  });
  it("copies a checked pending upload to a permanent key that the upload URL cannot overwrite", async () => {
    const storage = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ ContentLength: 100, ContentType: "image/png", ETag: '"etag"' })
        .mockResolvedValueOnce({}),
    };
    const service = new PublicMediaService(storage as never, {
      bucket: "media",
      privateBucket: "evidence",
      publicBaseUrl: "https://media.example",
    });
    expect(
      await service.complete({
        id: "id",
        object_key: "pending/project/file.png",
        public_url: "https://media.example/project/file.png",
        mime_type: "image/png",
        size_bytes: 100,
        ready: false,
      }),
    ).toEqual({ objectKey: "project/file.png" });
    const copy = storage.send.mock.calls[1]![0].input;
    expect(copy.Key).toBe("project/file.png");
    expect(copy.CopySourceIfMatch).toBe('"etag"');
  });
  it("rejects mismatched upload metadata", async () => {
    const storage = {
      send: vi.fn().mockResolvedValue({ ContentLength: 50, ContentType: "image/png" }),
    };
    const service = new PublicMediaService(storage as never, {
      bucket: "media",
      privateBucket: "evidence",
      publicBaseUrl: "https://media.example",
    });
    await expect(
      service.complete({
        id: "id",
        object_key: "pending/project/file.png",
        public_url: "https://media.example/project/file.png",
        mime_type: "image/png",
        size_bytes: 100,
        ready: false,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_MISMATCH" });
    expect(storage.send).toHaveBeenCalledTimes(1);
  });
});
