import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { CompetitorService } from "../../src/services/analytics/competitor.service.js";

let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let competitorService: CompetitorService;

const ownerId = randomUUID();
const tenantId = randomUUID();
const projectId = randomUUID();
const competitorId1 = randomUUID();
const competitorId2 = randomUUID();
const promptId1 = randomUUID();
const promptId2 = randomUUID();

const context = { tenantId, userId: ownerId };

// Unauthorized tenant for isolation
const otherTenantId = randomUUID();
const otherUserId = randomUUID();
const otherContext = { tenantId: otherTenantId, userId: otherUserId };

beforeAll(async () => {
  f = await createDatabaseFixture();

  // 1. Seed user, tenant, membership, project, competitor, and prompts
  await f.database.query(
    `INSERT INTO users (id, email, name, password_hash, email_verified_at)
     VALUES ($1, 'competitor-tester@example.com', 'Competitor Tester', 'hash', now()),
            ($2, 'other-competitor-tester@example.com', 'Other Tester', 'hash', now())`,
    [ownerId, otherUserId],
  );

  await f.database.query(
    `INSERT INTO tenants (id, name, region) 
     VALUES ($1, 'Competitor Main Tenant', 'us'),
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
    `INSERT INTO competitors (id, tenant_id, project_id, name, domain, aliases, competitor_type, rationale)
     VALUES ($1, $2, $3, 'ApexScale', 'apexscale.com', '["Apex Scale"]'::jsonb, 'direct', 'Primary SEO competitor'),
            ($4, $2, $3, 'OmniRank', 'omnirank.io', '["Omni"]'::jsonb, 'aspirational', 'Enterprise leader')`,
    [competitorId1, tenantId, projectId, competitorId2],
  );

  await f.database.query(
    `INSERT INTO monitoring_prompts (id, tenant_id, project_id, body, persona, tags, version, active)
     VALUES ($1, $2, $3, 'What are the best GEO visibility tools?', 'SEO Lead', ARRAY['Visibility'], 1, true),
            ($4, $2, $3, 'Compare Savoir AI vs ApexScale for answer optimization', 'Director', ARRAY['Brand Comparison'], 1, true)`,
    [promptId1, tenantId, projectId, promptId2],
  );

  // 2. Seed runs, answers, mentions, and citations
  // Run 1 (Prompt 1): Savoir mentioned at pos 1, ApexScale mentioned at pos 2 -> Savoir Win
  const runId1 = randomUUID();
  const ansId1 = randomUUID();
  await f.database.query(
    `INSERT INTO monitoring_runs (id, tenant_id, project_id, batch_key, item_key, request, status, created_at, completed_at)
     VALUES ($1, $2, $3, 'b1', 'i1', $4, 'succeeded', now() - interval '2 days', now())`,
    [
      runId1,
      tenantId,
      projectId,
      JSON.stringify({ engine: "openai", promptId: promptId1, geo: "US", language: "en" }),
    ],
  );
  await f.database.query(
    `INSERT INTO answers (id, tenant_id, project_id, run_id, prompt_id, engine, text, text_hash, has_citations)
     VALUES ($1, $2, $3, $4, $5, 'openai', 'Answer text 1', 'h1', true)`,
    [ansId1, tenantId, projectId, runId1, promptId1],
  );
  await f.database.query(
    `INSERT INTO mentions (id, tenant_id, project_id, answer_id, entity_name, entity_type, position_index, sentiment, snippet, matched_text)
     VALUES ($1, $2, $3, $4, 'Savoir AI', 'brand', 1, 1.0, 'Savoir AI is #1', 'Savoir AI'),
            ($5, $2, $3, $4, 'ApexScale', 'competitor', 2, 0.5, 'ApexScale is #2', 'ApexScale'),
            ($6, $2, $3, $4, 'EmergingBot', 'other', 3, 0.0, 'EmergingBot is #3', 'EmergingBot')`,
    [randomUUID(), tenantId, projectId, ansId1, randomUUID(), randomUUID()],
  );
  await f.database.query(
    `INSERT INTO citations (id, tenant_id, project_id, answer_id, url, normalized_url, domain, source_type)
     VALUES ($1, $2, $3, $4, 'https://savoir.io/features', 'https://savoir.io/features', 'savoir.io', 'brand'),
            ($5, $2, $3, $4, 'https://apexscale.com/compare', 'https://apexscale.com/compare', 'apexscale.com', 'competitor')`,
    [randomUUID(), tenantId, projectId, ansId1, randomUUID()],
  );

  // Run 2 (Prompt 2): ApexScale mentioned at pos 1, Savoir NOT mentioned -> Savoir Loss (GAP!)
  const runId2 = randomUUID();
  const ansId2 = randomUUID();
  await f.database.query(
    `INSERT INTO monitoring_runs (id, tenant_id, project_id, batch_key, item_key, request, status, created_at, completed_at)
     VALUES ($1, $2, $3, 'b2', 'i2', $4, 'succeeded', now() - interval '1 day', now())`,
    [
      runId2,
      tenantId,
      projectId,
      JSON.stringify({ engine: "gemini", promptId: promptId2, geo: "US", language: "en" }),
    ],
  );
  await f.database.query(
    `INSERT INTO answers (id, tenant_id, project_id, run_id, prompt_id, engine, text, text_hash, has_citations)
     VALUES ($1, $2, $3, $4, $5, 'gemini', 'Answer text 2', 'h2', true)`,
    [ansId2, tenantId, projectId, runId2, promptId2],
  );
  await f.database.query(
    `INSERT INTO mentions (id, tenant_id, project_id, answer_id, entity_name, entity_type, position_index, sentiment, snippet, matched_text)
     VALUES ($1, $2, $3, $4, 'ApexScale', 'competitor', 1, 1.0, 'ApexScale is top choice', 'ApexScale'),
            ($5, $2, $3, $4, 'EmergingBot', 'other', 2, 0.0, 'EmergingBot is also cited', 'EmergingBot')`,
    [randomUUID(), tenantId, projectId, ansId2, randomUUID()],
  );
  await f.database.query(
    `INSERT INTO citations (id, tenant_id, project_id, answer_id, url, normalized_url, domain, source_type)
     VALUES ($1, $2, $3, $4, 'https://apexscale.com/product', 'https://apexscale.com/product', 'apexscale.com', 'competitor')`,
    [randomUUID(), tenantId, projectId, ansId2],
  );

  competitorService = new CompetitorService(f.database);
});

afterAll(async () => {
  await f?.close();
});

describe("CompetitorService Integration Tests (CMP-FR-001 to CMP-FR-016)", () => {
  describe("Competitor Management CRUD (CMP-FR-001, CMP-FR-008)", () => {
    it("lists tracked competitors with calculated metrics and head-to-head records", async () => {
      const competitors = await competitorService.listCompetitors(context, projectId);
      expect(competitors.length).toBe(2);

      const apex = competitors.find((c) => c.name === "ApexScale");
      expect(apex).toBeDefined();
      expect(apex?.domain).toBe("apexscale.com");
      expect(apex?.competitorType).toBe("direct");
      expect(apex?.metrics.citationsCount).toBe(2);
      expect(apex?.metrics.visibilityRate).toBeGreaterThan(0);
      expect(apex?.metrics.headToHead.wins).toBeGreaterThanOrEqual(0);
    });

    it("creates a new competitor validating name, domain and competitor type", async () => {
      const created = await competitorService.createCompetitor(context, projectId, {
        name: "GrowthPilot",
        domain: "https://growthpilot.io",
        aliases: ["Growth Pilot", "growthpilot"],
        competitorType: "indirect",
        rationale: "Fast-growing challenger",
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe("GrowthPilot");
      expect(created.domain).toBe("growthpilot.io");
      expect(created.competitorType).toBe("indirect");

      // Verify in list
      const list = await competitorService.listCompetitors(context, projectId);
      expect(list.some((c) => c.id === created.id)).toBe(true);
    });

    it("updates competitor details and aliases", async () => {
      const updated = await competitorService.updateCompetitor(context, projectId, competitorId2, {
        competitorType: "direct",
        rationale: "Promoted to direct competitor",
      });

      expect(updated.id).toBe(competitorId2);
      expect(updated.competitorType).toBe("direct");
      expect(updated.rationale).toBe("Promoted to direct competitor");
    });

    it("enforces tenant isolation and rejects unauthorized tenant access", async () => {
      await expect(competitorService.listCompetitors(otherContext, projectId)).rejects.toThrow();

      await expect(
        competitorService.createCompetitor(otherContext, projectId, {
          name: "Intruder",
          domain: "intruder.com",
        }),
      ).rejects.toThrow();
    });

    it("enforces plan limit of max 25 competitors (CMP-FR-001)", async () => {
      // Seed competitors up to 25
      const currentList = await competitorService.listCompetitors(context, projectId);
      const needed = 25 - currentList.length;

      for (let i = 0; i < needed; i++) {
        await f.database.query(
          `INSERT INTO competitors (tenant_id, project_id, name, domain, competitor_type)
           VALUES ($1, $2, $3, $4, 'direct')`,
          [tenantId, projectId, `Test Comp ${i}`, `testcomp${i}.com`],
        );
      }

      // 26th should fail
      await expect(
        competitorService.createCompetitor(context, projectId, {
          name: "Comp 26",
          domain: "comp26.com",
        }),
      ).rejects.toThrow(/Maximum limit of 25 competitors/);

      // Clean up the extra seeded competitors
      await f.database.query(
        `DELETE FROM competitors WHERE project_id = $1 AND name LIKE 'Test Comp %'`,
        [projectId],
      );
    });
  });

  describe("Competitor Leaderboard (CMP-FR-004, CMP-FR-002)", () => {
    it("lists available prompt topics for analytics filters", async () => {
      await expect(competitorService.listTopics(context, projectId)).resolves.toEqual([
        "Brand Comparison",
        "Visibility",
      ]);
    });

    it("renders a leaderboard ranking brand and competitors by visibility rate and share of voice", async () => {
      const leaderboard = await competitorService.getLeaderboard(context, projectId, { days: 7 });
      expect(leaderboard.length).toBeGreaterThanOrEqual(3); // Savoir AI, ApexScale, OmniRank, GrowthPilot

      // Top entity
      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[0].shareOfVoice).toBeGreaterThan(0);
      expect(leaderboard[0].fairShare).toBeGreaterThan(0);

      // Find brand
      const brand = leaderboard.find((item) => item.isBrand);
      expect(brand).toBeDefined();
      expect(brand?.name).toBe("Savoir AI");

      // Find competitor
      const apex = leaderboard.find((item) => item.name === "ApexScale");
      expect(apex).toBeDefined();
      expect(apex?.isBrand).toBe(false);
      expect(apex?.domain).toBe("apexscale.com");
    });
  });

  describe("Head-to-Head Comparison (CMP-FR-003)", () => {
    it("filters head-to-head prompts by topic and excludes branded prompts when requested", async () => {
      const byTopic = await competitorService.getHeadToHead(context, projectId, competitorId1, {
        days: 7,
        topic: "Visibility",
      });
      expect(byTopic.prompts.map((prompt) => prompt.promptId)).toEqual([promptId1]);

      const nonBranded = await competitorService.getHeadToHead(context, projectId, competitorId1, {
        days: 7,
        nonBrandedOnly: true,
      });
      expect(nonBranded.prompts.map((prompt) => prompt.promptId)).toEqual([promptId1]);
    });

    it("computes head-to-head prompt wins, losses, and ties against a competitor", async () => {
      const h2h = await competitorService.getHeadToHead(context, projectId, competitorId1, {
        days: 7,
      });

      expect(h2h.competitor.name).toBe("ApexScale");
      expect(h2h.summary.totalPrompts).toBe(2);
      // Run 1: Savoir pos 1, Apex pos 2 -> Savoir WIN
      // Run 2: Savoir not mentioned, Apex pos 1 -> Savoir LOSS
      expect(h2h.summary.wins).toBe(1);
      expect(h2h.summary.losses).toBe(1);
      expect(h2h.summary.winRate).toBe(50.0);

      const p1 = h2h.prompts.find((p) => p.promptId === promptId1);
      expect(p1).toBeDefined();
      expect(p1?.outcome).toBe("win");
      expect(p1?.brandRank).toBe(1);
      expect(p1?.competitorRank).toBe(2);

      const p2 = h2h.prompts.find((p) => p.promptId === promptId2);
      expect(p2).toBeDefined();
      expect(p2?.outcome).toBe("loss");
      expect(p2?.brandRank).toBeNull();
      expect(p2?.competitorRank).toBe(1);
    });
  });

  describe("Competitive Gap Score (CMP-FR-005, CMP-FR-012)", () => {
    it("computes competitive gap scores for prompts where competitors appear and brand does not", async () => {
      const gaps = await competitorService.getCompetitiveGaps(context, projectId, { days: 7 });

      // Prompt 2: ApexScale mentioned, Savoir NOT mentioned -> Gap
      expect(gaps.length).toBeGreaterThan(0);

      const p2Gap = gaps.find((g) => g.promptId === promptId2 && g.competitorName === "ApexScale");
      expect(p2Gap).toBeDefined();
      expect(p2Gap?.competitorVis).toBe(1.0);
      expect(p2Gap?.brandVis).toBe(0.0);
      expect(p2Gap?.gapScore).toBeGreaterThan(0);
      expect(p2Gap?.reasons).toContain("Brand completely missing in answers for this prompt");

      // Verify cached in competitive_gaps table
      const cached = await f.database.query(
        `SELECT * FROM public.competitive_gaps WHERE project_id = $1 AND competitor_id = $2`,
        [projectId, competitorId1],
      );
      expect(cached.rows.length).toBeGreaterThan(0);
    });
  });

  describe("Competitor Auto-Discovery (CMP-FR-010, CMP-FR-016, Feature CMP-F1)", () => {
    it("auto-discovers entities appearing in >= 10% of runs and persists candidates", async () => {
      // EmergingBot appeared in both Run 1 and Run 2 (100% of runs >= 10% threshold)
      const candidates = await competitorService.runCompetitorAutoDiscovery(context, projectId);
      expect(candidates.length).toBeGreaterThan(0);

      const bot = candidates.find((c) => c.name === "EmergingBot");
      expect(bot).toBeDefined();
      expect(bot?.mentionFrequency).toBeGreaterThanOrEqual(0.1);
      expect(bot?.status).toBe("suggested");
    });

    it("accepts a candidate into the tracked competitors list", async () => {
      const candidates = await competitorService.listCandidates(context, projectId, "suggested");
      const bot = candidates.find((c) => c.name === "EmergingBot");
      expect(bot).toBeDefined();

      const accepted = await competitorService.acceptCandidate(context, projectId, bot!.id);
      expect(accepted.name).toBe("EmergingBot");

      // Candidate status should now be accepted
      const updatedList = await competitorService.listCandidates(context, projectId, "accepted");
      expect(updatedList.some((c) => c.id === bot!.id)).toBe(true);

      // And it should appear in competitors table
      const compList = await competitorService.listCompetitors(context, projectId);
      expect(compList.some((c) => c.name === "EmergingBot")).toBe(true);
    });

    it("rejects candidate and enforces 90-day cooldown", async () => {
      // Seed another candidate
      const candId = randomUUID();
      await f.database.query(
        `INSERT INTO competitor_candidates (id, tenant_id, project_id, name, mention_frequency, status)
         VALUES ($1, $2, $3, 'RejectedCandidate', 0.25, 'suggested')`,
        [candId, tenantId, projectId],
      );

      await competitorService.rejectCandidate(context, projectId, candId);

      const rejected = await competitorService.listCandidates(context, projectId, "rejected");
      const item = rejected.find((c) => c.id === candId);
      expect(item).toBeDefined();
      expect(item?.rejectedAt).not.toBeNull();

      // Discovery should skip it due to 90-day cooldown
      const discovered = await competitorService.runCompetitorAutoDiscovery(context, projectId);
      expect(discovered.some((c) => c.name === "RejectedCandidate")).toBe(false);
    });
  });

  describe("CSV Export (RFC 4180)", () => {
    it("exports leaderboard, head-to-head, and gaps to RFC 4180 CSV", async () => {
      const leaderboardCsv = await competitorService.exportCsv(context, projectId, "leaderboard");
      expect(leaderboardCsv).toContain("Rank,Entity,Domain,Type,Visibility Rate");
      expect(leaderboardCsv).toContain("Savoir AI");

      const h2hCsv = await competitorService.exportCsv(
        context,
        projectId,
        "head_to_head",
        {},
        competitorId1,
      );
      expect(h2hCsv).toContain("Prompt,Priority,Brand Rank,Competitor Rank");
      expect(h2hCsv).toContain("WIN");

      const gapsCsv = await competitorService.exportCsv(context, projectId, "gaps");
      expect(gapsCsv).toContain("Prompt,Priority,Competitor,Competitor Vis,Brand Vis,Gap Score");
      expect(gapsCsv).toContain("ApexScale");
    });
  });
});
