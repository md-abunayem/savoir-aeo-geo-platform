import { z } from "zod";
import type { StudioDocument } from "../content/content-studio.schema.js";
import {
  PublishingError,
  type PublishingChannel,
  type PublishingPlatform,
} from "./publishing.validation.js";

const postSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["draft", "error", "needs_approval", "scheduled", "sending", "sent"]),
    externalLink: z.string().nullable().optional(),
    notificationStatus: z.string().nullable().optional(),
    schedulingType: z.string().optional(),
  })
  .passthrough();
const postFields = "id status externalLink notificationStatus schedulingType";
export interface BufferChannel extends PublishingChannel {
  disconnected: boolean;
  locked: boolean;
  paused: boolean;
  hasDevice: boolean;
  reminders: boolean;
}
const services: Record<string, PublishingPlatform | undefined> = {
  facebook: "facebook",
  instagram: "instagram",
  twitter: "x",
  tiktok: "tiktok",
  youtube: "youtube",
};
export class BufferService {
  constructor(private readonly transport: typeof fetch = fetch) {}

  private async query(token: string, query: string, variables: unknown, mutation = false) {
    let response: Response;
    try {
      response = await this.transport("https://api.buffer.com", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new PublishingError("BUFFER_NETWORK_ERROR", undefined, mutation);
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new PublishingError(
        "BUFFER_RATE_LIMITED",
        Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400) : 60,
      );
    }
    if (!response.ok)
      throw new PublishingError("BUFFER_HTTP_ERROR", undefined, mutation && response.status >= 500);
    let payload: { data?: Record<string, unknown>; errors?: unknown[] };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new PublishingError("BUFFER_INVALID_RESPONSE", undefined, mutation);
    }
    if (payload.errors?.length || !payload.data)
      throw new PublishingError("BUFFER_GRAPHQL_ERROR", undefined, mutation);
    return payload.data;
  }

  async channels(token: string): Promise<BufferChannel[]> {
    const account = await this.query(token, "query { account { organizations { id } } }", {});
    const organizations = z
      .object({ organizations: z.array(z.object({ id: z.string() })).max(100) })
      .parse(account.account).organizations;
    const channels: BufferChannel[] = [];
    for (const org of organizations) {
      const data = await this.query(
        token,
        `query Channels($input: ChannelsInput!) { channels(input:$input) {
        id name service type isDisconnected isLocked isQueuePaused hasActiveMemberDevice
        metadata { ... on InstagramMetadata { defaultToReminders } ... on TiktokMetadata { defaultToReminders } ... on YoutubeMetadata { defaultToReminders } }
      } }`,
        { input: { organizationId: org.id } },
      );
      const rows = z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            service: z.string(),
            type: z.string(),
            isDisconnected: z.boolean(),
            isLocked: z.boolean(),
            isQueuePaused: z.boolean(),
            hasActiveMemberDevice: z.boolean(),
            metadata: z
              .object({ defaultToReminders: z.boolean().optional() })
              .passthrough()
              .nullable()
              .optional(),
          }),
        )
        .parse(data.channels);
      for (const row of rows) {
        const platform = services[row.service];
        if (!platform) continue;
        channels.push({
          id: row.id,
          name: row.name,
          platform,
          disconnected: row.isDisconnected,
          locked: row.isLocked,
          paused: row.isQueuePaused,
          hasDevice: row.hasActiveMemberDevice,
          reminders: Boolean(row.metadata?.defaultToReminders) || /personal|group/i.test(row.type),
        });
      }
    }
    return channels;
  }

  async createPost(
    token: string,
    input: {
      channel: BufferChannel;
      document: StudioDocument;
      media: Array<{ public_url: string; mime_type: string }>;
      schedulingType: "automatic" | "notification";
      dueAt?: string;
    },
  ) {
    const { channel, document, media } = input;
    if (channel.disconnected || channel.locked || channel.paused)
      throw new PublishingError("BUFFER_CHANNEL_UNAVAILABLE");
    const schedulingType = channel.reminders ? "notification" : input.schedulingType;
    if (schedulingType === "notification" && !channel.hasDevice)
      throw new PublishingError("BUFFER_MOBILE_DEVICE_REQUIRED");
    const content = document.content;
    const text =
      channel.platform === "facebook"
        ? `${content.facebook.caption}\n\n${content.facebook.cta}`
        : channel.platform === "instagram"
          ? content.instagram.caption
          : channel.platform === "x"
            ? content.x.thread[0]!
            : content.short_video.hook;
    const metadata =
      channel.platform === "x"
        ? { twitter: { thread: content.x.thread.map((text) => ({ text })) } }
        : channel.platform === "instagram"
          ? {
              instagram: {
                type: media[0]?.mime_type.startsWith("video/") ? "reel" : "post",
                shouldShareToFeed: true,
              },
            }
          : channel.platform === "youtube"
            ? {
                youtube: {
                  title: document.topic.slice(0, 100),
                  categoryId: "27",
                  privacy: "public",
                  madeForKids: false,
                },
              }
            : channel.platform === "tiktok"
              ? { tiktok: { isAiGenerated: true } }
              : undefined;
    const data = await this.query(
      token,
      `mutation Publish($input: CreatePostInput!) {
      createPost(input:$input) { __typename ... on PostActionSuccess { post { ${postFields} } } ... on MutationError { message } }
    }`,
      {
        input: {
          text,
          channelId: channel.id,
          assets: media.map((asset) =>
            asset.mime_type.startsWith("video/")
              ? { video: { url: asset.public_url } }
              : { image: { url: asset.public_url } },
          ),
          metadata,
          needsApproval: false,
          aiAssisted: true,
          schedulingType,
          mode: input.dueAt ? "customScheduled" : "shareNow",
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        },
      },
      true,
    );
    const result = data.createPost as { __typename?: string; post?: unknown } | undefined;
    if (result?.__typename !== "PostActionSuccess")
      throw new PublishingError(
        "BUFFER_POST_REJECTED",
        undefined,
        !result?.__typename || ["UnexpectedError", "RestProxyError"].includes(result.__typename),
      );
    try {
      return postSchema.parse(result.post);
    } catch {
      throw new PublishingError("BUFFER_INVALID_RESPONSE", undefined, true);
    }
  }

  /** Buffer schedules through createPost(mode:customScheduled), not a schedulePost mutation. */
  schedulePost(
    token: string,
    input: Parameters<BufferService["createPost"]>[1] & { dueAt: string },
  ) {
    return this.createPost(token, input);
  }
  async outcome(token: string, id: string) {
    const data = await this.query(
      token,
      `query Outcome($input:PostInput!) { post(input:$input) { ${postFields} } }`,
      { input: { id } },
    );
    const post = postSchema.parse(data.post);
    if (post.id !== id) throw new PublishingError("BUFFER_INVALID_RESPONSE");
    return post;
  }

  async analytics(
    token: string,
    id: string,
  ): Promise<{
    impressions: number;
    reach: number;
    likes: number;
    shares: number;
    comments: number;
    clicks: number;
  }> {
    const data = await this.query(
      token,
      `query PostAnalytics($input:PostInput!) { post(input:$input) { id status analytics { impressions reach likes shares comments clicks } } }`,
      { input: { id } },
    );
    const post = data.post as
      | {
          analytics?: Partial<{
            impressions: number;
            reach: number;
            likes: number;
            shares: number;
            comments: number;
            clicks: number;
          }>;
        }
      | undefined;
    return {
      impressions: Number(post?.analytics?.impressions) || 0,
      reach: Number(post?.analytics?.reach) || 0,
      likes: Number(post?.analytics?.likes) || 0,
      shares: Number(post?.analytics?.shares) || 0,
      comments: Number(post?.analytics?.comments) || 0,
      clicks: Number(post?.analytics?.clicks) || 0,
    };
  }
}
