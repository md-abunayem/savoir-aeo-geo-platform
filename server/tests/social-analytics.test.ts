import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { SocialAnalyticsService } from "../src/services/publishing/social-analytics.service.js";
import { ContentBriefGenerator } from "../src/services/content/content-brief-generator.js";

const mocks = vi.hoisted(() => ({
  tenantQuery: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../src/db/tenant.js", () => ({
  withTenantClient: async (
    _pool: unknown,
    context: unknown,
    operation: (client: unknown) => unknown,
  ) => {
    mocks.transaction(context);
    return operation({ query: mocks.tenantQuery });
  },
}));

const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const tenantId = "33333333-3333-4333-8333-333333333333";
const encryptionKey = Buffer.alloc(32, 7);

function setup() {
  const query = vi.fn().mockResolvedValue({ rows: [{ tenant_id: tenantId }] });
  const bufferService = {
    analytics: vi.fn().mockResolvedValue({
      impressions: 1250,
      reach: 1000,
      likes: 45,
      shares: 12,
      comments: 8,
      clicks: 25,
    }),
  };

  const service = new SocialAnalyticsService(
    { query } as unknown as Pool,
    encryptionKey,
    bufferService,
  );

  return { query, bufferService, service };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("SocialAnalyticsService (Phase 5 - Performance Analytics & Feedback)", () => {
  describe("Hook Style Classification & Metrics Calculation", () => {
    it("classifies curiosity_stat hooks when questions contain statistics or percentages", () => {
      const { service } = setup();
      expect(service.inferHookStyle("Why are 85% of startups failing their first AI audit?")).toBe(
        "curiosity_stat",
      );
      expect(service.inferHookStyle("Did you know $50k is wasted on generic social posts?")).toBe(
        "curiosity_stat",
      );
    });

    it("classifies contrarian hooks", () => {
      const { service } = setup();
      expect(service.inferHookStyle("Stop posting daily updates that nobody clicks on.")).toBe(
        "contrarian",
      );
      expect(service.inferHookStyle("Don't buy expensive scheduling suites yet.")).toBe(
        "contrarian",
      );
      expect(service.inferHookStyle("The biggest mistake marketers make in AEO")).toBe(
        "contrarian",
      );
    });

    it("classifies how_to, storytelling, and direct question hooks", () => {
      const { service } = setup();
      expect(service.inferHookStyle("How to rank in Google AI Overviews in 30 days")).toBe(
        "how_to",
      );
      expect(service.inferHookStyle("When we built our first answer engine crawler...")).toBe(
        "storytelling",
      );
      expect(service.inferHookStyle("Which answer engine drives the highest conversion?")).toBe(
        "question_direct",
      );
      expect(service.inferHookStyle("AEO requires structured entities and direct citations.")).toBe(
        "insight_statement",
      );
    });

    it("computes accurate engagement rate and normalized performance score", () => {
      const { service } = setup();
      const metrics = service.calculateMetrics({
        impressions: 2000,
        reach: 1000,
        likes: 40,
        shares: 10,
        comments: 10,
        clicks: 20,
        conversions: 2,
      });

      // Total engagements: 40 + 10 + 10 + 20 = 80
      expect(metrics.engagementCount).toBe(80);
      // Denominator: reach = 1000. 80 / 1000 = 0.0800 (8%)
      expect(metrics.engagementRate).toBe(0.08);
      expect(metrics.performanceScore).toBeGreaterThan(50);
      expect(metrics.performanceScore).toBeLessThanOrEqual(100);
    });
  });

  describe("Performance Ingestion & Top 5% Recalculation", () => {
    it("ingests performance record, recomputes cluster top performers and injects winning pattern directives", async () => {
      const { service } = setup();

      const insertedRow = {
        id: "perf-row-1",
        tenantId,
        projectId,
        deliveryId: null,
        draftId: null,
        platform: "instagram",
        channelId: "ig-chan-1",
        remotePostId: "post-123",
        topicCluster: "Customer Onboarding",
        assetFormat: "carousel",
        hookStyle: "curiosity_stat",
        hookText: "Why are 85% of users abandoning onboarding in week 1?",
        audienceIntent: "educational",
        impressions: 2500,
        reach: 2000,
        likes: 120,
        shares: 30,
        comments: 20,
        clicks: 45,
        conversions: 5,
        engagementCount: 215,
        engagementRate: "0.1075",
        conversionTag: "lead_magnet",
        performanceScore: "88.50",
        isTopPerformer: true,
        winningPatterns: [
          "Previous high-performing hooks for this topic used curiosity-based questions with direct statistics. Replicate this style.",
          "Format 'carousel' is top-performing with 10.8% engagement rate for this topic.",
          "Include proven conversion trigger tagged with 'lead_magnet'.",
        ],
        publishedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock upsert result
      mocks.tenantQuery.mockResolvedValueOnce({ rows: [insertedRow] });
      // Mock recalculate cluster query (1 row in cluster)
      mocks.tenantQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "perf-row-1",
            asset_format: "carousel",
            hook_style: "curiosity_stat",
            hook_text: "Why are 85% of users abandoning onboarding in week 1?",
            engagement_rate: "0.1075",
            performance_score: "88.50",
            conversion_tag: "lead_magnet",
          },
        ],
      });
      // Mock update top performer
      mocks.tenantQuery.mockResolvedValueOnce({ rows: [] });
      // Mock refreshed query
      mocks.tenantQuery.mockResolvedValueOnce({ rows: [insertedRow] });

      const result = await service.ingest(userId, projectId, {
        platform: "instagram",
        channelId: "ig-chan-1",
        remotePostId: "post-123",
        topicCluster: "Customer Onboarding",
        assetFormat: "carousel",
        hookText: "Why are 85% of users abandoning onboarding in week 1?",
        audienceIntent: "educational",
        impressions: 2500,
        reach: 2000,
        likes: 120,
        shares: 30,
        comments: 20,
        clicks: 45,
        conversions: 5,
        conversionTag: "lead_magnet",
      });

      expect(result.isTopPerformer).toBe(true);
      expect(result.winningPatterns).toContain(
        "Previous high-performing hooks for this topic used curiosity-based questions with direct statistics. Replicate this style.",
      );
      expect(mocks.transaction).toHaveBeenCalledWith({ userId, tenantId });
    });
  });

  describe("Strategy Feedback Loop in Content Brief Generator", () => {
    it("renders Section 9 with winning pattern directives when passed into generateBrief", () => {
      const generator = new ContentBriefGenerator();
      const brief = generator.generateBrief({
        title: "Optimizing Customer Onboarding",
        targetPrompts: ["How to improve customer onboarding?"],
        primaryIntent: "informational",
        brandName: "Acme Cloud",
        brandDomain: "acme.com",
        winningPatterns: [
          "Previous high-performing hooks for this topic used curiosity-based questions with direct statistics. Replicate this style.",
          "Format 'carousel' is top-performing with 10.8% engagement rate for this topic.",
        ],
      });

      expect(brief.winningPatterns).toHaveLength(2);
      expect(brief.markdownContent).toContain(
        "## 9. Performance-Optimized Winning Patterns (Closed-Loop Feedback)",
      );
      expect(brief.markdownContent).toContain(
        "Previous high-performing hooks for this topic used curiosity-based questions with direct statistics. Replicate this style.",
      );
    });
  });

  describe("Querying Top Performers and Summaries", () => {
    it("retrieves winning patterns for a cluster", async () => {
      const { service } = setup();

      mocks.tenantQuery.mockResolvedValueOnce({
        rows: [
          {
            winning_patterns: [
              "Previous high-performing hooks for this topic used curiosity-based questions with direct statistics. Replicate this style.",
            ],
          },
        ],
      });

      const patterns = await service.getWinningPatternsForCluster(
        userId,
        projectId,
        "Customer Onboarding",
      );

      expect(patterns).toEqual([
        "Previous high-performing hooks for this topic used curiosity-based questions with direct statistics. Replicate this style.",
      ]);
    });

    it("returns cluster performance summary", async () => {
      const { service } = setup();

      mocks.tenantQuery.mockResolvedValueOnce({
        rows: [
          {
            topicCluster: "Customer Onboarding",
            totalPosts: "12",
            totalImpressions: "25000",
            totalReach: "18000",
            totalEngagements: "1450",
            avgEngagementRate: "0.0805",
            topAssetFormat: "carousel",
            topHookStyle: "curiosity_stat",
            topPerformersCount: "1",
          },
        ],
      });

      const summary = await service.getClusterSummary(userId, projectId);
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatchObject({
        topicCluster: "Customer Onboarding",
        totalPosts: 12,
        totalImpressions: 25000,
        totalReach: 18000,
        totalEngagements: 1450,
        avgEngagementRate: 0.0805,
        topAssetFormat: "carousel",
        topHookStyle: "curiosity_stat",
        topPerformersCount: 1,
      });
    });
  });
});
