import { z } from "zod";
export const platformSchema = z.enum([
  "facebook",
  "instagram",
  "x",
  "tiktok",
  "youtube",
  "wordpress",
]);
export type PublishingPlatform = z.output<typeof platformSchema>;
export const scheduleSchema = z
  .object({
    revision: z.number().int().positive(),
    scheduledTime: z.iso.datetime({ offset: true }),
    targets: z
      .array(
        z
          .object({
            platform: platformSchema,
            channelId: z.string().min(1).max(200),
            mediaIds: z.array(z.uuid()).max(10).default([]),
            schedulingType: z.enum(["automatic", "notification"]).default("automatic"),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((v, ctx) => {
    const keys = v.targets.map((t) => `${t.platform}:${t.channelId}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "Duplicate targets" });
  });
export const revisionSchema = z.object({ revision: z.number().int().positive() }).strict();
export const mediaInputSchema = z
  .object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4"]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
  })
  .strict();
export type MediaRecord = {
  id: string;
  public_url: string;
  mime_type: string;
  size_bytes: number;
  ready: boolean;
  object_key: string;
};
export interface PublishingChannel {
  id: string;
  name: string;
  platform: PublishingPlatform;
}
export class PublishingError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryAfter?: number,
    public readonly uncertain = false,
  ) {
    super(code);
  }
}
