import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withTenantClient, type TenantContext } from "../../db/tenant.js";
import { ApiError } from "../../utils/ApiError.js";
import { TokenCrypto } from "../integrations/token-crypto.js";
import { createContentStudioService } from "../content/content-studio.service.js";
import { FactCheckerService } from "../content/fact-checker.service.js";
import { MemoryService } from "../memory/memory.service.js";
import {
  studioDocumentSchema,
  type StudioDocument,
  type StudioInput,
} from "../content/content-studio.schema.js";
import type { ValidationReport } from "../content/content-studio.types.js";
import { BufferService } from "./buffer.service.js";
import { WordPressService } from "./wordpress.service.js";
import { PublicMediaService } from "./media.service.js";
import {
  PublishingError,
  mediaInputSchema,
  scheduleSchema,
  type MediaRecord,
  type PublishingChannel,
} from "./publishing.validation.js";

export interface DraftRecord {
  id: string;
  project_id: string;
  tenant_id: string;
  document: StudioDocument;
  validation: ValidationReport | null;
  revision: number;
  status: "draft" | "in_review" | "approved" | "scheduled" | "published" | "failed";
  approved_revision: number | null;
  approved_by: string | null;
  scheduled_time: Date | null;
}
export interface PublishingOptions {
  enabled: boolean;
  tokenKey?: string;
  apiKey?: string;
  model: string;
}
export function requireRevision(
  draft: DraftRecord,
  revision: number,
  allowed: DraftRecord["status"][],
) {
  if (draft.revision !== revision || !allowed.includes(draft.status))
    throw new ApiError(
      409,
      "The draft changed or this action is not allowed in its current state. Reload and review it.",
      "STUDIO_CONFLICT",
    );
}
export function validateTargetMedia(
  platform: string,
  media: MediaRecord[],
  document: StudioDocument,
) {
  const video = media.filter((m) => m.mime_type === "video/mp4");
  if (video.length && (video.length !== 1 || media.length !== 1))
    throw new ApiError(400, "Use one video or a set of images", "INVALID_TARGET_MEDIA");
  if (["youtube", "tiktok"].includes(platform) && (media.length !== 1 || video.length !== 1))
    throw new ApiError(400, "TikTok and YouTube require one uploaded MP4 video", "VIDEO_REQUIRED");
  if (
    platform === "instagram" &&
    (!media.length ||
      (!video.length && media.length !== document.content.instagram.carousel_slides.length))
  )
    throw new ApiError(
      400,
      "Upload one image per Instagram carousel slide, or one MP4 reel",
      "CAROUSEL_MEDIA_REQUIRED",
    );
  if (platform === "x" && media.length > 4)
    throw new ApiError(400, "Use at most four X images", "INVALID_TARGET_MEDIA");
}

export class ApprovalService {
  readonly buffer: BufferService;
  readonly wordpress: WordPressService;
  constructor(
    readonly pool: Pool,
    readonly options: PublishingOptions,
    readonly media: PublicMediaService,
    dependencies: { buffer?: BufferService; wordpress?: WordPressService } = {},
  ) {
    this.buffer = dependencies.buffer ?? new BufferService();
    this.wordpress = dependencies.wordpress ?? new WordPressService();
  }
  async context(userId: string, projectId: string): Promise<TenantContext> {
    const result = await this.pool.query("SELECT savoir_project_context($1,$2) AS tenant_id", [
      z.uuid().parse(userId),
      z.uuid().parse(projectId),
    ]);
    if (!result.rows[0]?.tenant_id) throw new ApiError(404, "Project not found", "NOT_FOUND");
    return { userId, tenantId: result.rows[0].tenant_id as string };
  }
  key() {
    if (!this.options.tokenKey || !/^[a-f0-9]{64}$/i.test(this.options.tokenKey))
      throw new ApiError(
        503,
        "Configure publishing credential encryption",
        "PUBLISHING_NOT_CONFIGURED",
      );
    return Buffer.from(this.options.tokenKey, "hex");
  }
  async draft(
    client: PoolClient,
    projectId: string,
    id: string,
    lock = false,
  ): Promise<DraftRecord> {
    const result = await client.query<DraftRecord>(
      `SELECT * FROM studio_drafts WHERE id=$1 AND project_id=$2 ${lock ? "FOR UPDATE" : ""}`,
      [z.uuid().parse(id), projectId],
    );
    if (!result.rows[0]) throw new ApiError(404, "Draft not found", "NOT_FOUND");
    return result.rows[0];
  }
  async list(userId: string, projectId: string) {
    const context = await this.context(userId, projectId);
    return withTenantClient(this.pool, context, async (client) => {
      const drafts = await client.query(
        "SELECT * FROM studio_drafts WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 50",
        [projectId],
      );
      const connections = await client.query(
        "SELECT id,provider,channels,updated_at FROM publishing_connections WHERE project_id=$1",
        [projectId],
      );
      const media = await client.query(
        "SELECT id,public_url,mime_type,size_bytes,ready FROM studio_media WHERE project_id=$1 AND ready ORDER BY created_at DESC LIMIT 100",
        [projectId],
      );
      const deliveries = await client.query(
        "SELECT d.* FROM publishing_deliveries d WHERE d.project_id=$1 ORDER BY d.updated_at DESC LIMIT 100",
        [projectId],
      );
      return {
        drafts: drafts.rows,
        connections: connections.rows,
        media: media.rows,
        deliveries: deliveries.rows,
        publishingEnabled: this.options.enabled,
      };
    });
  }
  async create(userId: string, projectId: string, input: unknown) {
    const document = studioDocumentSchema.parse(input);
    if (document.brand_id !== projectId)
      throw new ApiError(400, "Document belongs to another project", "INVALID_BRAND");
    const context = await this.context(userId, projectId);
    return withTenantClient(
      this.pool,
      context,
      async (client) =>
        (
          await client.query(
            "INSERT INTO studio_drafts(tenant_id,project_id,document) VALUES($1,$2,$3) RETURNING *",
            [context.tenantId, projectId, JSON.stringify(document)],
          )
        ).rows[0],
    );
  }
  async generate(userId: string, projectId: string, input: StudioInput) {
    const context = await this.context(userId, projectId);
    const result = await createContentStudioService(this.pool, context, this.options).generate(
      projectId,
      input,
    );
    return withTenantClient(
      this.pool,
      context,
      async (client) =>
        (
          await client.query(
            "INSERT INTO studio_drafts(tenant_id,project_id,document,validation) VALUES($1,$2,$3,$4) RETURNING *",
            [
              context.tenantId,
              projectId,
              JSON.stringify(result.document),
              JSON.stringify(result.validation),
            ],
          )
        ).rows[0],
    );
  }
  async edit(userId: string, projectId: string, id: string, revision: number, input: unknown) {
    const document = studioDocumentSchema.parse(input);
    if (document.brand_id !== projectId)
      throw new ApiError(400, "Document belongs to another project", "INVALID_BRAND");
    const context = await this.context(userId, projectId);
    return withTenantClient(this.pool, context, async (client) => {
      const draft = await this.draft(client, projectId, id, true);
      requireRevision(draft, revision, ["draft", "in_review", "approved"]);
      return (
        await client.query(
          "UPDATE studio_drafts SET document=$2,revision=revision+1,status='draft',validation=NULL,approved_by=NULL,approved_revision=NULL,updated_at=now() WHERE id=$1 RETURNING *",
          [id, JSON.stringify(document)],
        )
      ).rows[0];
    });
  }
  async review(userId: string, projectId: string, id: string, revision: number) {
    const context = await this.context(userId, projectId);
    const draft = await withTenantClient(this.pool, context, (client) =>
      this.draft(client, projectId, id),
    );
    requireRevision(draft, revision, ["draft", "in_review"]);
    const report = await this.verify(context, draft.document);
    return withTenantClient(this.pool, context, async (client) => {
      const current = await this.draft(client, projectId, id, true);
      requireRevision(current, revision, ["draft", "in_review"]);
      return (
        await client.query(
          "UPDATE studio_drafts SET validation=$2,status='in_review',updated_at=now() WHERE id=$1 RETURNING *",
          [id, JSON.stringify(report)],
        )
      ).rows[0];
    });
  }
  async verify(context: TenantContext, document: StudioDocument) {
    if (!this.options.apiKey)
      throw new ApiError(503, "Configure the fact checker before review", "STUDIO_NOT_CONFIGURED");
    return new FactCheckerService(
      new MemoryService(this.pool, context, this.options.apiKey),
      this.options,
    ).check(document);
  }
  async approve(userId: string, projectId: string, id: string, revision: number) {
    const context = await this.context(userId, projectId);
    return withTenantClient(this.pool, context, async (client) => {
      const draft = await this.draft(client, projectId, id, true);
      requireRevision(draft, revision, ["in_review"]);
      if (!draft.validation?.passed)
        throw new ApiError(409, "Resolve validation flags before approval", "VALIDATION_REQUIRED");
      return (
        await client.query(
          "UPDATE studio_drafts SET status='approved',approved_by=$2,approved_revision=revision,updated_at=now() WHERE id=$1 RETURNING *",
          [id, userId],
        )
      ).rows[0];
    });
  }
  async schedule(userId: string, projectId: string, id: string, input: unknown) {
    if (!this.options.enabled)
      throw new ApiError(503, "Publishing is not enabled", "PUBLISHING_DISABLED");
    const value = scheduleSchema.parse(input);
    const scheduled = new Date(value.scheduledTime);
    if (
      scheduled.getTime() < Date.now() + 30000 ||
      scheduled.getTime() > Date.now() + 365 * 86400000
    )
      throw new ApiError(
        400,
        "Choose a time from 30 seconds to one year in the future",
        "INVALID_SCHEDULE",
      );
    const context = await this.context(userId, projectId);
    return withTenantClient(this.pool, context, async (client) => {
      const draft = await this.draft(client, projectId, id, true);
      requireRevision(draft, value.revision, ["approved"]);
      if (draft.approved_revision !== draft.revision || !draft.validation?.passed)
        throw new ApiError(409, "This revision requires review and approval", "APPROVAL_REQUIRED");
      const connections = (
        await client.query<{ provider: string; channels: PublishingChannel[] }>(
          "SELECT provider,channels FROM publishing_connections WHERE project_id=$1",
          [projectId],
        )
      ).rows;
      for (const target of value.targets) {
        const connection = connections.find(
          (c) => c.provider === (target.platform === "wordpress" ? "wordpress" : "buffer"),
        );
        if (
          !connection?.channels.some(
            (c) => c.id === target.channelId && c.platform === target.platform,
          )
        )
          throw new ApiError(
            400,
            "Connect and select a matching publishing account",
            "INVALID_CHANNEL",
          );
        const media = (
          await client.query<MediaRecord>(
            "SELECT * FROM studio_media WHERE project_id=$1 AND id=ANY($2::uuid[]) AND ready",
            [projectId, target.mediaIds],
          )
        ).rows;
        if (media.length !== target.mediaIds.length)
          throw new ApiError(400, "Select ready media from this project", "MEDIA_NOT_READY");
        validateTargetMedia(target.platform, media, draft.document);
        await client.query(
          "INSERT INTO publishing_deliveries(tenant_id,project_id,draft_id,revision,platform,channel_id,media_ids,scheduling_type,next_attempt_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            context.tenantId,
            projectId,
            id,
            draft.revision,
            target.platform,
            target.channelId,
            JSON.stringify(target.mediaIds),
            target.schedulingType,
            scheduled,
          ],
        );
      }
      return (
        await client.query(
          "UPDATE studio_drafts SET status='scheduled',scheduled_time=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [id, scheduled],
        )
      ).rows[0];
    });
  }
  async connect(
    userId: string,
    projectId: string,
    provider: "buffer" | "wordpress",
    input: unknown,
  ) {
    const context = await this.context(userId, projectId);
    const key = this.key();
    let credentials: unknown;
    let channels: PublishingChannel[];
    if (provider === "buffer") {
      credentials = z
        .object({ accessToken: z.string().trim().min(1).max(10000) })
        .strict()
        .parse(input);
      try {
        channels = await this.buffer.channels((credentials as { accessToken: string }).accessToken);
      } catch {
        throw new ApiError(
          400,
          "Could not connect to Buffer. Check the access token and account permissions.",
          "BUFFER_CONNECTION_FAILED",
        );
      }
    } else {
      const value = z
        .object({
          siteUrl: z.url(),
          username: z.string().min(1).max(200),
          applicationPassword: z.string().min(1).max(1000),
        })
        .strict()
        .parse(input);
      try {
        await this.wordpress.verify(value);
      } catch (error) {
        throw new ApiError(
          400,
          error instanceof PublishingError && error.code === "WORDPRESS_SCHEMA_PLUGIN_REQUIRED"
            ? "Install and activate the Savoir Article Schema WordPress plugin before connecting."
            : "Could not connect to WordPress. Use a public HTTPS site and check the application password and permissions.",
          "WORDPRESS_CONNECTION_FAILED",
        );
      }
      credentials = value;
      channels = [{ id: "wordpress", name: value.siteUrl, platform: "wordpress" }];
    }
    const encrypted = TokenCrypto.encrypt(credentials, key);
    return withTenantClient(
      this.pool,
      context,
      async (client) =>
        (
          await client.query(
            `INSERT INTO publishing_connections(tenant_id,project_id,provider,encrypted_credentials,channels) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(project_id,provider) DO UPDATE SET encrypted_credentials=EXCLUDED.encrypted_credentials,channels=EXCLUDED.channels,updated_at=now()
       RETURNING id,provider,channels,updated_at`,
            [context.tenantId, projectId, provider, encrypted, JSON.stringify(channels)],
          )
        ).rows[0],
    );
  }
  async prepareMedia(userId: string, projectId: string, input: unknown) {
    const context = await this.context(userId, projectId);
    const media = await this.media.prepare(projectId, mediaInputSchema.parse(input));
    await withTenantClient(this.pool, context, (client) =>
      client.query(
        "INSERT INTO studio_media(id,tenant_id,project_id,object_key,public_url,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          media.id,
          context.tenantId,
          projectId,
          media.objectKey,
          media.publicUrl,
          media.mimeType,
          media.sizeBytes,
        ],
      ),
    );
    return media;
  }
  async completeMedia(userId: string, projectId: string, id: string) {
    const context = await this.context(userId, projectId);
    return withTenantClient(this.pool, context, async (client) => {
      const row = (
        await client.query<MediaRecord>(
          "SELECT * FROM studio_media WHERE id=$1 AND project_id=$2 FOR UPDATE",
          [z.uuid().parse(id), projectId],
        )
      ).rows[0];
      if (!row) throw new ApiError(404, "Media not found", "NOT_FOUND");
      const finalized = await this.media.complete(row);
      await client.query("UPDATE studio_media SET ready=true,object_key=$2 WHERE id=$1", [
        id,
        finalized.objectKey,
      ]);
      return { id, ready: true };
    });
  }
}
