import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { VisibilityService } from "../../src/services/analytics/visibility.service.js";

let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let visibilityService: VisibilityService;

const ownerId = randomUUID();
const tenantId = randomUUID();
const projectId = randomUUID();
const competitorId = randomUUID();
const promptId = randomUUID();

const context = { tenantId, userId: ownerId };

// Other tenant for isolation checks
const otherTenantId = randomUUID();
const otherUserId = randomUUID();
const otherContext = { tenantId: otherTenantId, userId: otherUserId };

beforeAll(async () => {
  f = await createDatabaseFixture();

  // 1. Seed user, tenant, membership, project, competitor, and prompt
  await f.database.query(
    `INSERT INTO users (id, email, name, password_hash, email_verified_at)
     VALUES ($1, 'vis-tester@example.com', 'Visibility Tester', 'hash', now()),
            ($2, 'other-tester@example.com', 'Other Tester', 'hash', now())`,
    [ownerId, otherUserId],
  );

  await f.database.query(
    `INSERT INTO tenants (id, name, region) 
     VALUES ($1, 'Visibility Main Tenant', 'us'),
            ($2, 'Other Tenant', 'us')`,
    [tenantId, otherTenantId],
  );

  await f.database.query(
    `INSERT INTO memberships (tenant_id, user_id, role) 
     VALUES ($1, $2, 'owner'),
            ($3, $4, 'owner')`,
    [tenantId, ownerId, otherTenantId, otherUserId],
  );

  await f.database.query(
    `INSERT INTO projects (id, tenant_id, brand_name, domain, aliases, status)
     VALUES ($1, $2, 'Savoir AI', 'https://savoir.io', '["Savoir", "savoir.io"]'::jsonb, 'active')`,
    [projectId, tenantId],
  );

  await f.database.query(
    `INSERT INTO competitors (id, tenant_id, project_id, name, domain, aliases)
     VALUES ($1, $2, $3, 'ApexScale', 'https://apexscale.com', '["Apex Scale"]'::jsonb)`,
    [competitorId, tenantId, projectId],
  );

  await f.database.query(
    `INSERT INTO monitoring_prompts (id, tenant_id, project_id, body, persona, version, active)
     VALUES ($1, $2, $3, 'Which AI engine optimization tool is best?', 'SEO Lead', 1, true)`,
    [promptId, tenantId, projectId],
  );

  // 2. Seed 6 runs to satisfy n >= 5 minimum sample size requirement
  // 4 runs where brand is mentioned (rank 1, positive sentiment +1, brand cited)
  // 2 runs where competitor is mentioned instead
  for (let i = 1; i <= 6; i++) {
    const runId = randomUUID();
    const answerId = randomUUID();
    const engine = i <= 3 ? "openai" : "gemini";
    const isBrandRun = i <= 4;

    await f.database.query(
      `INSERT INTO monitoring_runs (id, tenant_id, project_id, batch_key, item_key, request, status, created_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', now() - interval '1 hour', now())`,
      [
        runId,
        tenantId,
        projectId,
        `batch_${i}`,
        `item_${i}`,
        JSON.stringify({ engine, promptId, geo: "US", language: "en" }),
      ],
    );

    await f.database.query(
      `INSERT INTO answers (id, tenant_id, project_id, run_id, prompt_id, engine, geo, language, text, text_hash, has_citations)
       VALUES ($1, $2, $3, $4, $5, $6, 'US', 'en', 'Test answer text content', 'hash_${i}', true)`,
      [answerId, tenantId, projectId, runId, promptId, engine],
    );

    if (isBrandRun) {
      // Brand mention (rank 1, sentiment +1, high confidence 0.95)
      await f.database.query(
        `INSERT INTO mentions (id, tenant_id, project_id, answer_id, entity_type, entity_name, matched_text, position_index, list_rank, sentiment, confidence, snippet)
         VALUES ($1, $2, $3, $4, 'brand', 'Savoir AI', 'Savoir AI', 10, 1, 1, '0.950', 'Savoir AI is recommended')`,
        [randomUUID(), tenantId, projectId, answerId],
      );

      // Brand citation
      await f.database.query(
        `INSERT INTO citations (id, tenant_id, project_id, answer_id, url, normalized_url, domain, source_type)
         VALUES ($1, $2, $3, $4, 'https://savoir.io/features', 'https://savoir.io/features', 'savoir.io', 'brand')`,
        [randomUUID(), tenantId, projectId, answerId],
      );
    } else {
      // Competitor mention
      await f.database.query(
        `INSERT INTO mentions (id, tenant_id, project_id, answer_id, entity_type, entity_id, entity_name, matched_text, position_index, list_rank, sentiment, confidence, snippet)
         VALUES ($1, $2, $3, $4, 'competitor', $5, 'ApexScale', 'ApexScale', 10, 1, 1, '0.900', 'ApexScale alternative')`,
        [randomUUID(), tenantId, projectId, answerId, competitorId],
      );

      // Competitor citation
      await f.database.query(
        `INSERT INTO citations (id, tenant_id, project_id, answer_id, url, normalized_url, domain, source_type)
         VALUES ($1, $2, $3, $4, 'https://apexscale.com', 'https://apexscale.com', 'apexscale.com', 'competitor')`,
        [randomUUID(), tenantId, projectId, answerId],
      );
    }
  }

  visibilityService = new VisibilityService(f.database);
});

afterAll(async () => {
  await f?.close();
});

describe("VisibilityService Integration Tests (VIS-FR-001 to VIS-FR-011)", () => {
  describe("Overview KPIs & Normative Composite Score (VIS-FR-001 to 007)", () => {
    it("computes accurate visibility rate, share of voice, Wilson CIs, and composite score", async () => {
      const overview = await visibilityService.getVisibilityOverview(context, projectId, {
        days: 7,
      });

      expect(overview.project.brandName).toBe("Savoir AI");
      expect(overview.sampleSummary.totalValidRuns).toBe(6);
      expect(overview.sampleSummary.brandMentionedRuns).toBe(4);

      // Visibility Rate (4 / 6 = 0.6667)
      const v = overview.metrics.visibilityRate;
      expect(v.value).toBeCloseTo(0.6667, 2);
      expect(v.label).toBe("Observed");
      expect(v.confidenceTier).toBe("adequate");
      expect(v.displayable).toBe(true);
      expect(v.ciLow).toBeDefined();
      expect(v.ciHigh).toBeDefined();
      expect(v.ciLow!).toBeLessThan(v.value);
      expect(v.ciHigh!).toBeGreaterThan(v.value);

      // Share of Voice (SoV): Brand mentions = 4, Comp mentions = 2 -> total = 6. SoV = 4/6
      const sov = overview.metrics.shareOfVoice;
      expect(sov.label).toBe("Modeled");
      expect(sov.value).toBeCloseTo(0.6667, 2);
      expect(overview.composite.fairShare).toBe(0.5); // 1 / (1 + 1 competitor) = 0.5
      expect(overview.composite.sovRatio).toBe(1.0); // min(1, 0.6667 / 0.5) = 1.0

      // Mention Position Score: All brand mentions had rank 1 -> mean(1/1) = 1.0
      const pos = overview.metrics.positionScore;
      expect(pos.value).toBe(1.0);
      expect(pos.label).toBe("Observed");

      // Sentiment Score: All brand mentions had s = +1 -> (1 + 1)/2 = 1.0
      const sent = overview.metrics.sentimentScore;
      expect(sent.value).toBe(1.0);
      expect(sent.label).toBe("Estimated");
      expect(overview.metrics.netSentiment.value).toBe(100);

      // Citation Rate: 4 brand cited runs / 6 runs with citations = 0.6667
      const cr = overview.metrics.citationRate;
      expect(cr.value).toBeCloseTo(0.6667, 2);
      expect(cr.label).toBe("Observed");

      // Recommended Rate: all 4 brand runs were rank 1 and positive = 4/6 = 0.6667
      const rec = overview.metrics.recommendedRate;
      expect(rec.value).toBeCloseTo(0.6667, 2);
      expect(rec.label).toBe("Modeled");

      // Composite Score:
      // 100 * (0.45 * 0.6667 + 0.20 * 1.0 + 0.15 * 1.0 + 0.10 * 1.0 + 0.10 * 0.6667)
      // = 100 * (0.30 + 0.20 + 0.15 + 0.10 + 0.0667) = ~81.67 -> Grade B
      expect(overview.composite.score).toBeGreaterThan(80);
      expect(overview.composite.score).toBeLessThan(85);
      expect(overview.composite.grade).toBe("B");
      expect(overview.composite.label).toBe("Modeled");

      // Breakdown by competitor
      expect(overview.competitors.length).toBe(1);
      expect(overview.competitors[0].name).toBe("ApexScale");
      expect(overview.competitors[0].mentionCount).toBe(2);
      expect(overview.competitors[0].visibilityRate).toBeCloseTo(0.3333, 2);

      // Breakdown by engine
      expect(overview.engines.length).toBe(5);
      const openaiEng = overview.engines.find((e) => e.engine === "openai");
      const geminiEng = overview.engines.find((e) => e.engine === "gemini");
      expect(openaiEng?.n).toBe(3);
      expect(geminiEng?.n).toBe(3);
    });

    it("enforces tenant isolation and throws on access to unauthorized project", async () => {
      await expect(
        visibilityService.getVisibilityOverview(otherContext, projectId),
      ).rejects.toThrow("Project not found or access denied");
    });
  });

  describe("Trend Series & 7-Day Rolling Smoothing (VIS-FR-010)", () => {
    it("returns daily trend points with smoothed rolling average and milestones", async () => {
      const trend = await visibilityService.getTrend(context, projectId, { days: 7 });

      expect(trend.points.length).toBeGreaterThan(0);
      expect(trend.events.length).toBeGreaterThan(0);

      const latestPoint = trend.points[trend.points.length - 1];
      expect(latestPoint.visibilityRate).toBeDefined();
      expect(latestPoint.rollingAvg).toBeDefined();
      expect(latestPoint.compositeScore).toBeGreaterThan(0);
    });
  });

  describe("Anomaly Detection with FDR Control (VIS-FR-008)", () => {
    it("evaluates anomaly candidates and applies Benjamini-Hochberg adjustment", async () => {
      const result = await visibilityService.getAnomalies(context, projectId, { days: 7 });

      expect(result.totalEvaluated).toBeGreaterThan(0);
      expect(result.fdrQ).toBe(0.05);
      expect(Array.isArray(result.anomalies)).toBe(true);
    });
  });

  describe("CSV Export (VIS-FR-009)", () => {
    it("exports comprehensive CSV formatted metrics", async () => {
      const csv = await visibilityService.exportCsv(context, projectId, { days: 7 });

      expect(csv).toContain("ProjectID,BrandName,DateFrom,DateTo,Engine,Market,MetricName");
      expect(csv).toContain("composite_score");
      expect(csv).toContain("visibility_rate");
      expect(csv).toContain("share_of_voice");
      expect(csv).toContain("citation_rate");
      expect(csv).toContain("competitor_visibility_apexscale");
    });
  });

  describe("Daily Fact Persistence (VIS-FR-001 & Section 6.2)", () => {
    it("aggregates and upserts daily facts into metric_facts table", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const insertedCount = await visibilityService.aggregateDailyFacts(tenantId, projectId, today);

      expect(insertedCount).toBe(6);

      const check = await f.database.query(
        `SELECT metric_name, value, label, n FROM metric_facts 
         WHERE project_id = $1 AND date = $2::date`,
        [projectId, today],
      );

      expect(check.rows.length).toBe(6);
      const visFact = check.rows.find((r) => r.metric_name === "visibility_rate");
      expect(visFact).toBeDefined();
      expect(visFact.label).toBe("Observed");
      expect(Number(visFact.value)).toBeCloseTo(0.6667, 2);
    });
  });

  describe("Saved Views & Metric Goals CRUD (VIS-FR-011)", () => {
    let savedViewId: string;
    let goalId: string;

    it("creates, retrieves, and deletes saved dashboard views", async () => {
      const view = await visibilityService.createSavedView(context, projectId, {
        name: "Weekly Executive View",
        filters: { days: 7, engine: "openai" },
      });

      expect(view.id).toBeDefined();
      expect(view.name).toBe("Weekly Executive View");
      savedViewId = view.id;

      const list = await visibilityService.listSavedViews(context, projectId);
      expect(list.some((v) => v.id === savedViewId)).toBe(true);

      const del = await visibilityService.deleteSavedView(context, projectId, savedViewId);
      expect(del.success).toBe(true);
    });

    it("creates, retrieves, and deletes metric goals", async () => {
      const goal = await visibilityService.createMetricGoal(context, projectId, {
        metricName: "composite_score",
        targetValue: 85,
        deadline: "2026-12-31",
      });

      expect(goal.id).toBeDefined();
      expect(goal.metric_name).toBe("composite_score");
      expect(goal.target_value).toBe(85);
      goalId = goal.id;

      const list = await visibilityService.listMetricGoals(context, projectId);
      expect(list.some((g) => g.id === goalId)).toBe(true);

      const del = await visibilityService.deleteMetricGoal(context, projectId, goalId);
      expect(del.success).toBe(true);
    });
  });
});
