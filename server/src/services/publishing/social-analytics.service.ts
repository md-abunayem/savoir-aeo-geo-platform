import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withTenantClient } from "../../db/tenant.js";
import { ApiError } from "../../utils/ApiError.js";
import { TokenCrypto } from "../integrations/token-crypto.js";
import { BufferService } from "./buffer.service.js";
import type { StudioDocument } from "../content/content-studio.schema.js";

export const performanceIngestSchema = z.object({
  deliveryId: z.string().uuid().optional(),
  draftId: z.string().uuid().optional(),
  platform: z.enum([
    "facebook",
    "instagram",
    "x",
    "tiktok",
    "youtube",
    "wordpress",
    "reddit",
    "other",
  ]),
  channelId: z.string().min(1).max(255),
  remotePostId: z.string().min(1).max(255).optional(),
  topicCluster: z.string().trim().min(1).max(255),
  assetFormat: z.string().trim().min(1).max(100),
  hookStyle: z.string().trim().min(1).max(100).optional(),
  hookText: z.string().trim().min(1).max(10000),
  audienceIntent: z
    .enum(["awareness", "consideration", "decision", "retention", "educational"])
    .default("awareness"),
  impressions: z.number().int().min(0).default(0),
  reach: z.number().int().min(0).default(0),
  likes: z.number().int().min(0).default(0),
  shares: z.number().int().min(0).default(0),
  comments: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  conversions: z.number().int().min(0).default(0),
  conversionTag: z.string().trim().max(100).optional(),
  publishedAt: z.union([z.string(), z.date()]).optional(),
});

export type PerformanceIngestInput = z.infer<typeof performanceIngestSchema>;

export interface PerformanceRecord {
  id: string;
  tenantId: string;
  projectId: string;
  deliveryId: string | null;
  draftId: string | null;
  platform: string;
  channelId: string;
  remotePostId: string | null;
  topicCluster: string;
  assetFormat: string;
  hookStyle: string;
  hookText: string;
  audienceIntent: string;
  impressions: number;
  reach: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
  conversions: number;
  engagementCount: number;
  engagementRate: number;
  conversionTag: string | null;
  performanceScore: number;
  isTopPerformer: boolean;
  winningPatterns: string[];
  publishedAt: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClusterPerformanceSummary {
  topicCluster: string;
  totalPosts: number;
  totalImpressions: number;
  totalReach: number;
  totalEngagements: number;
  avgEngagementRate: number;
  topAssetFormat: string;
  topHookStyle: string;
  topPerformersCount: number;
}

export class SocialAnalyticsService {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKey: Buffer,
    private readonly bufferService: Pick<BufferService, "analytics"> = new BufferService(),
  ) {}

  /**
   * Automatically classifies hook text into established hook styles if not provided
   */
  inferHookStyle(hookText: string): string {
    const trimmed = hookText.trim();
    if (/[0-9]|%|\$/.test(trimmed) && trimmed.includes("?")) {
      return "curiosity_stat";
    }
    if (/\b(stop|don't|never|wrong|myth|mistake|flawed|why you shouldn't)\b/i.test(trimmed)) {
      return "contrarian";
    }
    if (/^(how to|why|what is|the secret to|guide to)\b/i.test(trimmed)) {
      return "how_to";
    }
    if (/\b(i |my |we |our |when we|my journey|i spent)\b/i.test(trimmed)) {
      return "storytelling";
    }
    if (trimmed.endsWith("?")) {
      return "question_direct";
    }
    return "insight_statement";
  }

  /**
   * Computes engagement count, rate and a normalized 0-100 performance score
   */
  calculateMetrics(input: {
    impressions?: number;
    reach?: number;
    likes?: number;
    shares?: number;
    comments?: number;
    clicks?: number;
    conversions?: number;
  }): { engagementCount: number; engagementRate: number; performanceScore: number } {
    const likes = input.likes ?? 0;
    const shares = input.shares ?? 0;
    const comments = input.comments ?? 0;
    const clicks = input.clicks ?? 0;
    const conversions = input.conversions ?? 0;
    const reach = input.reach ?? 0;
    const impressions = input.impressions ?? 0;

    const engagementCount = likes + shares + comments + clicks;
    const denominator = reach > 0 ? reach : impressions > 0 ? impressions : 0;
    const engagementRate = denominator > 0 ? Math.min(1, engagementCount / denominator) : 0;

    // Weighted composite score (0 - 100):
    // - Engagement rate weight: up to 50 pts (e.g. 10% engagement rate = 50 pts)
    // - Conversion contribution: up to 30 pts (e.g. 3 conversions = 30 pts)
    // - Scale/Reach factor: up to 20 pts (logarithmic scale of impressions)
    const rateComponent = Math.min(50, engagementRate * 500);
    const convComponent = Math.min(30, conversions * 10);
    const volumeComponent = impressions > 0 ? Math.min(20, Math.log10(impressions) * 5) : 0;
    const performanceScore = Math.min(
      100,
      Math.round((rateComponent + convComponent + volumeComponent) * 100) / 100,
    );

    return {
      engagementCount,
      engagementRate: Math.round(engagementRate * 10000) / 10000,
      performanceScore,
    };
  }

  private async getProjectTenant(projectId: string): Promise<string> {
    const res = await this.pool.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM public.projects WHERE id = $1",
      [projectId],
    );
    if (!res.rows[0]) {
      throw new ApiError(404, "Project not found", "PROJECT_NOT_FOUND");
    }
    return res.rows[0].tenant_id;
  }

  /**
   * Ingests a published post's performance record into performance_memory
   * and triggers the self-improving recalculation of top 5% performers in that topic cluster.
   */
  async ingest(
    userId: string,
    projectId: string,
    rawInput: PerformanceIngestInput,
  ): Promise<PerformanceRecord> {
    z.string().uuid().parse(projectId);
    const input = performanceIngestSchema.parse(rawInput);
    const tenantId = await this.getProjectTenant(projectId);
    const hookStyle = input.hookStyle || this.inferHookStyle(input.hookText);
    const { engagementCount, engagementRate, performanceScore } = this.calculateMetrics(input);

    return withTenantClient(this.pool, { userId, tenantId }, async (client) => {
      const publishedAt = input.publishedAt
        ? new Date(input.publishedAt).toISOString()
        : new Date().toISOString();

      let record: PerformanceRecord;

      if (input.remotePostId) {
        const upsertRes = await client.query(
          `INSERT INTO public.performance_memory (
             tenant_id, project_id, delivery_id, draft_id, platform, channel_id,
             remote_post_id, topic_cluster, asset_format, hook_style, hook_text,
             audience_intent, impressions, reach, likes, shares, comments, clicks,
             conversions, engagement_count, engagement_rate, conversion_tag,
             performance_score, published_at, synced_at, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW(), NOW()
           )
           ON CONFLICT (project_id, platform, remote_post_id) DO UPDATE SET
             impressions = EXCLUDED.impressions,
             reach = EXCLUDED.reach,
             likes = EXCLUDED.likes,
             shares = EXCLUDED.shares,
             comments = EXCLUDED.comments,
             clicks = EXCLUDED.clicks,
             conversions = EXCLUDED.conversions,
             engagement_count = EXCLUDED.engagement_count,
             engagement_rate = EXCLUDED.engagement_rate,
             performance_score = EXCLUDED.performance_score,
             conversion_tag = COALESCE(EXCLUDED.conversion_tag, performance_memory.conversion_tag),
             synced_at = NOW(),
             updated_at = NOW()
           RETURNING
             id, tenant_id as "tenantId", project_id as "projectId",
             delivery_id as "deliveryId", draft_id as "draftId", platform,
             channel_id as "channelId", remote_post_id as "remotePostId",
             topic_cluster as "topicCluster", asset_format as "assetFormat",
             hook_style as "hookStyle", hook_text as "hookText",
             audience_intent as "audienceIntent", impressions, reach, likes,
             shares, comments, clicks, conversions, engagement_count as "engagementCount",
             engagement_rate as "engagementRate", conversion_tag as "conversionTag",
             performance_score as "performanceScore", is_top_performer as "isTopPerformer",
             winning_patterns as "winningPatterns", published_at as "publishedAt",
             synced_at as "syncedAt", created_at as "createdAt", updated_at as "updatedAt"`,
          [
            tenantId,
            projectId,
            input.deliveryId ?? null,
            input.draftId ?? null,
            input.platform,
            input.channelId,
            input.remotePostId,
            input.topicCluster,
            input.assetFormat,
            hookStyle,
            input.hookText,
            input.audienceIntent,
            input.impressions,
            input.reach,
            input.likes,
            input.shares,
            input.comments,
            input.clicks,
            input.conversions,
            engagementCount,
            engagementRate,
            input.conversionTag ?? null,
            performanceScore,
            publishedAt,
          ],
        );
        record = upsertRes.rows[0];
      } else {
        const insertRes = await client.query(
          `INSERT INTO public.performance_memory (
             tenant_id, project_id, delivery_id, draft_id, platform, channel_id,
             remote_post_id, topic_cluster, asset_format, hook_style, hook_text,
             audience_intent, impressions, reach, likes, shares, comments, clicks,
             conversions, engagement_count, engagement_rate, conversion_tag,
             performance_score, published_at, synced_at, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW(), NOW()
           )
           RETURNING
             id, tenant_id as "tenantId", project_id as "projectId",
             delivery_id as "deliveryId", draft_id as "draftId", platform,
             channel_id as "channelId", remote_post_id as "remotePostId",
             topic_cluster as "topicCluster", asset_format as "assetFormat",
             hook_style as "hookStyle", hook_text as "hookText",
             audience_intent as "audienceIntent", impressions, reach, likes,
             shares, comments, clicks, conversions, engagement_count as "engagementCount",
             engagement_rate as "engagementRate", conversion_tag as "conversionTag",
             performance_score as "performanceScore", is_top_performer as "isTopPerformer",
             winning_patterns as "winningPatterns", published_at as "publishedAt",
             synced_at as "syncedAt", created_at as "createdAt", updated_at as "updatedAt"`,
          [
            tenantId,
            projectId,
            input.deliveryId ?? null,
            input.draftId ?? null,
            input.platform,
            input.channelId,
            null,
            input.topicCluster,
            input.assetFormat,
            hookStyle,
            input.hookText,
            input.audienceIntent,
            input.impressions,
            input.reach,
            input.likes,
            input.shares,
            input.comments,
            input.clicks,
            input.conversions,
            engagementCount,
            engagementRate,
            input.conversionTag ?? null,
            performanceScore,
            publishedAt,
          ],
        );
        record = insertRes.rows[0];
      }

      // Automatically recalculate cluster top performers & extract winning directives
      await this.recalculateClusterTopPerformers(client, tenantId, projectId, input.topicCluster);

      // Return the refreshed record with its updated top performer status
      const refreshed = await client.query(
        `SELECT id, tenant_id as "tenantId", project_id as "projectId",
                delivery_id as "deliveryId", draft_id as "draftId", platform,
                channel_id as "channelId", remote_post_id as "remotePostId",
                topic_cluster as "topicCluster", asset_format as "assetFormat",
                hook_style as "hookStyle", hook_text as "hookText",
                audience_intent as "audienceIntent", impressions, reach, likes,
                shares, comments, clicks, conversions, engagement_count as "engagementCount",
                engagement_rate as "engagementRate", conversion_tag as "conversionTag",
                performance_score as "performanceScore", is_top_performer as "isTopPerformer",
                winning_patterns as "winningPatterns", published_at as "publishedAt",
                synced_at as "syncedAt", created_at as "createdAt", updated_at as "updatedAt"
         FROM public.performance_memory
         WHERE id = $1`,
        [record.id],
      );

      return refreshed.rows[0] ?? record;
    });
  }

  /**
   * Recalculates top 5% performing assets in the topic cluster and updates winning patterns.
   */
  private async recalculateClusterTopPerformers(
    client: PoolClient,
    tenantId: string,
    projectId: string,
    topicCluster: string,
  ): Promise<void> {
    const clusterItemsRes = await client.query<{
      id: string;
      asset_format: string;
      hook_style: string;
      hook_text: string;
      engagement_rate: string | number;
      performance_score: string | number;
      conversion_tag: string | null;
    }>(
      `SELECT id, asset_format, hook_style, hook_text, engagement_rate,
              performance_score, conversion_tag
       FROM public.performance_memory
       WHERE tenant_id = $1 AND project_id = $2 AND topic_cluster = $3
       ORDER BY performance_score DESC, engagement_rate DESC`,
      [tenantId, projectId, topicCluster],
    );

    const rows = clusterItemsRes.rows;
    if (rows.length === 0) return;

    // Calculate top 5% threshold count (at least 1 item is marked top performer if data exists)
    const topCount = Math.max(1, Math.ceil(rows.length * 0.05));
    const nonTopIds = rows.slice(topCount).map((r) => r.id);

    // Reset non-top performers
    if (nonTopIds.length > 0) {
      await client.query(
        `UPDATE public.performance_memory
         SET is_top_performer = false, winning_patterns = '[]'::jsonb, updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [nonTopIds],
      );
    }

    // Generate winning patterns for top performers
    for (const topItem of rows.slice(0, topCount)) {
      const patterns: string[] = [];
      const ratePct = (Number(topItem.engagement_rate) * 100).toFixed(1);

      // Strategy Feedback Directive generation based on Blueprint requirements:
      if (topItem.hook_style === "curiosity_stat") {
        patterns.push(
          "Previous high-performing hooks for this topic used curiosity-based questions with direct statistics. Replicate this style.",
        );
      } else if (topItem.hook_style === "contrarian") {
        patterns.push(
          "Contrarian myth-busting hooks achieved highest engagement in this cluster. Challenge standard industry assumptions.",
        );
      } else if (topItem.hook_style === "how_to") {
        patterns.push(
          "Action-oriented 'How-to' step-by-step guidance resonated strongest with the audience.",
        );
      } else if (topItem.hook_style === "storytelling") {
        patterns.push(
          "Personal founder or customer journey narrative with tangible hurdles drove peak engagement.",
        );
      } else {
        patterns.push(
          `High-performing hook structure (${topItem.hook_style}) achieved top-tier engagement in '${topicCluster}'.`,
        );
      }

      patterns.push(
        `Format '${topItem.asset_format}' is top-performing with ${ratePct}% engagement rate for this topic.`,
      );

      if (topItem.conversion_tag) {
        patterns.push(`Include proven conversion trigger tagged with '${topItem.conversion_tag}'.`);
      }

      await client.query(
        `UPDATE public.performance_memory
         SET is_top_performer = true, winning_patterns = $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [topItem.id, JSON.stringify(patterns)],
      );
    }
  }

  /**
   * Polls Buffer GraphQL API for published post metrics (impressions, reach, likes, shares, clicks),
   * maps them to the associated content draft, and ingests them into performance memory.
   */
  async pollBufferAnalytics(
    userId: string,
    projectId: string,
    deliveryId: string,
  ): Promise<PerformanceRecord> {
    z.string().uuid().parse(projectId);
    z.string().uuid().parse(deliveryId);
    const tenantId = await this.getProjectTenant(projectId);

    return withTenantClient(this.pool, { userId, tenantId }, async (client) => {
      // 1. Fetch delivery details
      const deliveryRes = await client.query<{
        id: string;
        draft_id: string;
        platform: string;
        channel_id: string;
        remote_id: string | null;
        state: string;
        document: StudioDocument;
      }>(
        `SELECT d.id, d.draft_id, d.platform, d.channel_id, d.remote_id, d.state,
                a.document
         FROM public.publishing_deliveries d
         JOIN public.studio_drafts a ON a.id = d.draft_id
         WHERE d.id = $1 AND d.project_id = $2 AND d.tenant_id = $3`,
        [deliveryId, projectId, tenantId],
      );

      const delivery = deliveryRes.rows[0];
      if (!delivery) {
        throw new ApiError(404, "Publishing delivery not found", "DELIVERY_NOT_FOUND");
      }
      if (!delivery.remote_id) {
        throw new ApiError(
          400,
          "Delivery has no remote post ID; post may not be published yet",
          "DELIVERY_NOT_PUBLISHED",
        );
      }

      // 2. Fetch connection credentials for Buffer
      const connRes = await client.query<{ encrypted_credentials: string }>(
        `SELECT encrypted_credentials
         FROM public.publishing_connections
         WHERE project_id = $1 AND tenant_id = $2 AND provider = 'buffer'`,
        [projectId, tenantId],
      );

      const connection = connRes.rows[0];
      if (!connection) {
        throw new ApiError(404, "Buffer connection not configured", "CONNECTION_MISSING");
      }

      const credentials = TokenCrypto.decrypt<{ accessToken?: string }>(
        connection.encrypted_credentials,
        this.encryptionKey,
      );
      if (!credentials.accessToken) {
        throw new ApiError(400, "Buffer access token is invalid or missing", "TOKEN_MISSING");
      }

      // 3. Query Buffer for live post metrics
      const metrics = await this.bufferService.analytics(
        credentials.accessToken,
        delivery.remote_id,
      );

      // 4. Extract hook text from draft document
      const doc = delivery.document;
      const topicCluster = doc.topic;
      let hookText = doc.question;
      let assetFormat = "social_post";

      if (delivery.platform === "facebook") {
        hookText = doc.content.facebook.caption.split("\n")[0] || doc.content.facebook.caption;
        assetFormat = "feed_post";
      } else if (delivery.platform === "instagram") {
        hookText = doc.content.instagram.caption.split("\n")[0] || doc.content.instagram.caption;
        assetFormat = doc.content.instagram.carousel_slides.length > 1 ? "carousel" : "image_post";
      } else if (delivery.platform === "x") {
        hookText = doc.content.x.thread[0] || doc.question;
        assetFormat = doc.content.x.thread.length > 1 ? "thread" : "single_post";
      } else if (delivery.platform === "tiktok" || delivery.platform === "youtube") {
        hookText = doc.content.short_video.hook;
        assetFormat = "short_video";
      } else if (delivery.platform === "wordpress") {
        hookText = doc.content.blog.answer_first_intro.split("\n")[0] || doc.content.blog.title;
        assetFormat = "blog_article";
      }

      const hookStyle = this.inferHookStyle(hookText);

      // 5. Ingest into performance memory
      return this.ingest(userId, projectId, {
        deliveryId: delivery.id,
        draftId: delivery.draft_id,
        platform: delivery.platform as PerformanceIngestInput["platform"],
        channelId: delivery.channel_id,
        remotePostId: delivery.remote_id,
        topicCluster,
        assetFormat,
        hookStyle,
        hookText,
        audienceIntent: doc.intent as PerformanceIngestInput["audienceIntent"],
        impressions: metrics.impressions,
        reach: metrics.reach,
        likes: metrics.likes,
        shares: metrics.shares,
        comments: metrics.comments,
        clicks: metrics.clicks,
        conversions: 0,
      });
    });
  }

  /**
   * Queries top 5% performing assets in a topic cluster (or whole project)
   */
  async getTopPerformingAssets(
    userId: string,
    projectId: string,
    options: { topicCluster?: string; limit?: number } = {},
  ): Promise<PerformanceRecord[]> {
    z.string().uuid().parse(projectId);
    const tenantId = await this.getProjectTenant(projectId);
    const limit = Math.min(50, Math.max(1, options.limit ?? 5));

    return withTenantClient(this.pool, { userId, tenantId }, async (client) => {
      let query = `
        SELECT id, tenant_id as "tenantId", project_id as "projectId",
               delivery_id as "deliveryId", draft_id as "draftId", platform,
               channel_id as "channelId", remote_post_id as "remotePostId",
               topic_cluster as "topicCluster", asset_format as "assetFormat",
               hook_style as "hookStyle", hook_text as "hookText",
               audience_intent as "audienceIntent", impressions, reach, likes,
               shares, comments, clicks, conversions, engagement_count as "engagementCount",
               engagement_rate as "engagementRate", conversion_tag as "conversionTag",
               performance_score as "performanceScore", is_top_performer as "isTopPerformer",
               winning_patterns as "winningPatterns", published_at as "publishedAt",
               synced_at as "syncedAt", created_at as "createdAt", updated_at as "updatedAt"
        FROM public.performance_memory
        WHERE project_id = $1 AND tenant_id = $2
      `;
      const params: unknown[] = [projectId, tenantId];

      if (options.topicCluster) {
        params.push(options.topicCluster);
        query += ` AND topic_cluster = $${params.length}`;
      }

      query += ` AND is_top_performer = true ORDER BY performance_score DESC, engagement_rate DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const res = await client.query(query, params);
      return res.rows;
    });
  }

  /**
   * Strategy Feedback Loop:
   * Returns winning pattern directives for a topic cluster to be injected into generation prompts and briefs.
   * E.g. "Previous high-performing hooks for this topic used curiosity-based questions with direct statistics. Replicate this style."
   */
  async getWinningPatternsForCluster(
    userId: string,
    projectId: string,
    topicCluster: string,
  ): Promise<string[]> {
    z.string().uuid().parse(projectId);
    const tenantId = await this.getProjectTenant(projectId);

    return withTenantClient(this.pool, { userId, tenantId }, async (client) => {
      const res = await client.query<{ winning_patterns: string[] }>(
        `SELECT winning_patterns
         FROM public.performance_memory
         WHERE project_id = $1 AND tenant_id = $2 AND topic_cluster = $3 AND is_top_performer = true
         ORDER BY performance_score DESC, engagement_rate DESC
         LIMIT 5`,
        [projectId, tenantId, topicCluster],
      );

      const set = new Set<string>();
      for (const row of res.rows) {
        if (Array.isArray(row.winning_patterns)) {
          for (const pattern of row.winning_patterns) {
            if (typeof pattern === "string" && pattern.trim()) {
              set.add(pattern.trim());
            }
          }
        }
      }

      // If no explicit cluster patterns found yet, attempt project-level top performers fallback
      if (set.size === 0) {
        const fallbackRes = await client.query<{ winning_patterns: string[] }>(
          `SELECT winning_patterns
           FROM public.performance_memory
           WHERE project_id = $1 AND tenant_id = $2 AND is_top_performer = true
           ORDER BY performance_score DESC
           LIMIT 3`,
          [projectId, tenantId],
        );
        for (const row of fallbackRes.rows) {
          if (Array.isArray(row.winning_patterns)) {
            for (const pattern of row.winning_patterns) {
              if (typeof pattern === "string" && pattern.trim()) {
                set.add(pattern.trim());
              }
            }
          }
        }
      }

      return Array.from(set);
    });
  }

  /**
   * Summarizes performance across topic clusters
   */
  async getClusterSummary(userId: string, projectId: string): Promise<ClusterPerformanceSummary[]> {
    z.string().uuid().parse(projectId);
    const tenantId = await this.getProjectTenant(projectId);

    return withTenantClient(this.pool, { userId, tenantId }, async (client) => {
      const res = await client.query<{
        topicCluster: string;
        totalPosts: string;
        totalImpressions: string;
        totalReach: string;
        totalEngagements: string;
        avgEngagementRate: string;
        topAssetFormat: string;
        topHookStyle: string;
        topPerformersCount: string;
      }>(
        `SELECT
           topic_cluster as "topicCluster",
           COUNT(*)::text as "totalPosts",
           COALESCE(SUM(impressions), 0)::text as "totalImpressions",
           COALESCE(SUM(reach), 0)::text as "totalReach",
           COALESCE(SUM(engagement_count), 0)::text as "totalEngagements",
           COALESCE(AVG(engagement_rate), 0)::text as "avgEngagementRate",
           MODE() WITHIN GROUP (ORDER BY asset_format) as "topAssetFormat",
           MODE() WITHIN GROUP (ORDER BY hook_style) as "topHookStyle",
           COUNT(*) FILTER (WHERE is_top_performer = true)::text as "topPerformersCount"
         FROM public.performance_memory
         WHERE project_id = $1 AND tenant_id = $2
         GROUP BY topic_cluster
         ORDER BY AVG(engagement_rate) DESC`,
        [projectId, tenantId],
      );

      return res.rows.map((r) => ({
        topicCluster: r.topicCluster,
        totalPosts: Number(r.totalPosts),
        totalImpressions: Number(r.totalImpressions),
        totalReach: Number(r.totalReach),
        totalEngagements: Number(r.totalEngagements),
        avgEngagementRate: Number(Number(r.avgEngagementRate).toFixed(4)),
        topAssetFormat: r.topAssetFormat || "social_post",
        topHookStyle: r.topHookStyle || "statement",
        topPerformersCount: Number(r.topPerformersCount),
      }));
    });
  }
}
