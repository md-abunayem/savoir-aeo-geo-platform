import { randomUUID } from "node:crypto";
import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "../../utils/ApiError.js";
import { mediaInputSchema, type MediaRecord } from "./publishing.validation.js";

export class PublicMediaService {
  constructor(
    private readonly storage: S3Client,
    private readonly config: { bucket?: string; privateBucket: string; publicBaseUrl?: string },
  ) {}
  private configured() {
    if (
      !this.config.bucket ||
      this.config.bucket === this.config.privateBucket ||
      !this.config.publicBaseUrl ||
      new URL(this.config.publicBaseUrl).protocol !== "https:"
    ) {
      throw new ApiError(
        503,
        "Configure a dedicated public media bucket and HTTPS media URL",
        "PUBLIC_MEDIA_NOT_CONFIGURED",
      );
    }
    return { bucket: this.config.bucket, base: this.config.publicBaseUrl.replace(/\/$/, "") };
  }
  async prepare(projectId: string, input: unknown) {
    const { mimeType, sizeBytes } = mediaInputSchema.parse(input);
    const config = this.configured();
    const id = randomUUID();
    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "video/mp4": "mp4",
    }[mimeType];
    const finalKey = `${projectId}/${id}.${extension}`;
    const objectKey = `pending/${finalKey}`;
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      ContentType: mimeType,
      ContentLength: sizeBytes,
      CacheControl: "public, max-age=31536000, immutable",
    });
    // Content type/length are signed; only the pending object key is writable by this URL.
    const uploadUrl = await getSignedUrl(this.storage, command, {
      expiresIn: 900,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return {
      id,
      objectKey,
      mimeType,
      sizeBytes,
      publicUrl: `${config.base}/${finalKey}`,
      uploadUrl,
    };
  }
  async complete(record: MediaRecord) {
    const config = this.configured();
    const object = await this.storage.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: record.object_key }),
    );
    if (object.ContentLength !== record.size_bytes || object.ContentType !== record.mime_type) {
      throw new ApiError(
        400,
        "Uploaded file does not match its declared type and size",
        "MEDIA_MISMATCH",
      );
    }
    if (record.ready) return { objectKey: record.object_key };
    const finalKey = record.object_key.replace(/^pending\//, "");
    if (finalKey === record.object_key)
      throw new ApiError(400, "Invalid pending media key", "MEDIA_MISMATCH");
    await this.storage.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        Key: finalKey,
        CopySource: `${config.bucket}/${encodeURIComponent(record.object_key)}`,
        CopySourceIfMatch: object.ETag,
      }),
    );
    return { objectKey: finalKey };
  }
}
