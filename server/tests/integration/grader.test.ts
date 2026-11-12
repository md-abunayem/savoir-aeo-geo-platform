import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { GraderService } from "../../src/services/grader/grader.service.js";

let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let graderService: GraderService;

const testUserId = randomUUID();

beforeAll(async () => {
  f = await createDatabaseFixture();

  // Seed user for conversion test
  await f.database.query(
    `INSERT INTO users (id, email, name, password_hash, email_verified_at)
     VALUES ($1, 'grader-user@example.com', 'Grader User', 'hash', now())`,
    [testUserId],
  );

  graderService = new GraderService(f.database, undefined, {
    allowLocalTest: true,
    dailySpendLimitUsd: 10.0,
  });
});

afterAll(async () => {
  await f?.close();
});

describe("AI Search Grader (M19 / HG-01 to HG-24, HG-FR-001 to HG-FR-006)", () => {
  let createdShareToken: string;
  let _createdReportId: string;

  describe("Public Submission & Pipeline Execution (HG-01, HG-02, HG-04 to HG-09)", () => {
    it("accepts public submission without login, executes pipeline, and computes Grade (HG-01, HG-02, HG-09)", async () => {
      const result = await graderService.submitGrader(
        {
          brandName: "Acme Cloud",
          domain: "acmecloud.example",
          category: "Software & Technology",
          country: "US",
          competitors: [
            { name: "MegaPlatform", domain: "megaplatform.example" },
            { name: "ApexScale", domain: "apexscale.example" },
          ],
        },
        "198.51.100.1",
        "device-fingerprint-1",
      );

      expect(result.reportId).toBeDefined();
      expect(result.shareToken).toBeDefined();
      expect(result.shareToken).toHaveLength(32); // 16 bytes hex = 32 chars (128-bit)
      expect(result.status).toBe("completed");
      expect(result.progress).toBe(100);
      expect(result.isCached).toBe(false);

      createdShareToken = result.shareToken;
      _createdReportId = result.reportId;

      const report = result.report!;
      expect(report).toBeDefined();
      expect(report.brandName).toBe("Acme Cloud");
      expect(report.normalizedDomain).toBe("acmecloud.example");
      expect(report.competitors).toHaveLength(2);
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
      expect(["A", "B", "C", "D", "F"]).toContain(report.grade);
    });

    it("auto-discovers competitors when none are provided (HG-07)", async () => {
      const result = await graderService.submitGrader(
        {
          brandName: "SearchGenius",
          domain: "searchgenius.example",
          category: "SEO & Search",
          country: "US",
        },
        "198.51.100.2",
        "device-fingerprint-2",
      );

      const report = result.report!;
      expect(report.competitors.length).toBeGreaterThanOrEqual(2);
      expect(report.competitors.some((c) => c.name.toLowerCase() !== "searchgenius")).toBe(true);
    });

    it("generates 12 to 15 seed prompts across 5 buyer intents (HG-06)", async () => {
      const report = await graderService.getReportByShareToken(createdShareToken);
      expect(report.prompts.length).toBeGreaterThanOrEqual(12);

      const intents = new Set(report.prompts.map((p) => p.intent));
      expect(intents.has("category_discovery")).toBe(true);
      expect(intents.has("best_of")).toBe(true);
      expect(intents.has("comparison")).toBe(true);
      expect(intents.has("problem_solution")).toBe(true);
      expect(intents.has("brand_specific")).toBe(true);
    });
  });

  describe("Normative Metric Formulas & Scoring (HG-10 to HG-13, HG-FR-001, HG-FR-002)", () => {
    it("computes Visibility Rate, Share of Voice, Position Score, and Citation Rate per Section 9 (HG-FR-001, HG-FR-002)", async () => {
      const report = await graderService.getReportByShareToken(createdShareToken);
      const m = report.metrics;

      expect(m.visibilityRate).toBeGreaterThanOrEqual(0);
      expect(m.visibilityRate).toBeLessThanOrEqual(1);

      expect(m.shareOfVoice).toBeGreaterThanOrEqual(0);
      expect(m.shareOfVoice).toBeLessThanOrEqual(1);

      expect(m.fairShare).toBeGreaterThan(0);
      expect(m.positionScore).toBeGreaterThanOrEqual(0);
      expect(m.sentimentScore).toBeGreaterThanOrEqual(0);
      expect(m.citationScore).toBeGreaterThanOrEqual(0);

      // Verify exact HG-FR-002 formula
      const sovRatio = m.fairShare > 0 ? Math.min(1.0, m.shareOfVoice / m.fairShare) : 0;
      const expectedScore = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            100 *
              (0.45 * m.visibilityRate +
                0.2 * sovRatio +
                0.15 * m.positionScore +
                0.1 * m.sentimentScore +
                0.1 * m.citationScore),
          ),
        ),
      );

      expect(report.score).toBe(expectedScore);
      expect(m.formula).toContain("0.45 * VisibilityRate");
    });
  });

  describe("Brand Perception Summary & Technical Audit (HG-14 to HG-18)", () => {
    it("generates brand perception summary with descriptors, positioning and strengths/weaknesses (HG-14)", async () => {
      const report = await graderService.getReportByShareToken(createdShareToken);
      const bp = report.brandPerception;

      expect(bp.descriptors.length).toBeGreaterThan(0);
      expect(bp.positioning).toBeDefined();
      expect(bp.strengths.length).toBeGreaterThan(0);
      expect(bp.weaknesses.length).toBeGreaterThan(0);
    });

    it("performs light technical check of robots.txt AI bots, llms.txt and schema (HG-17)", async () => {
      const report = await graderService.getReportByShareToken(createdShareToken);
      const tech = report.technicalAudit;

      expect(tech.statusCode).toBe(200);
      expect(tech.robotsTxt.bots.GPTBot).toBeDefined();
      expect(tech.robotsTxt.bots["Google-Extended"]).toBeDefined();
      expect(tech.llmsTxt).toBeDefined();
      expect(tech.schemaOrg).toBeDefined();
    });

    it("generates 3 to 5 prioritized actionable recommendations (HG-18)", async () => {
      const report = await graderService.getReportByShareToken(createdShareToken);
      expect(report.recommendations.length).toBeGreaterThanOrEqual(3);
      expect(report.recommendations.length).toBeLessThanOrEqual(5);

      const firstRec = report.recommendations[0];
      expect(firstRec.title).toBeDefined();
      expect(firstRec.impact).toBeDefined();
      expect(firstRec.effort).toBeDefined();
      expect(firstRec.actionableStep).toBeDefined();
    });
  });

  describe("Abuse Controls & Rate Limiting (HG-03, NFR-COST-004, NFR-SEC-010)", () => {
    it("enforces IP rate limit: maximum 3 reports per 24 hours per IP (HG-03)", async () => {
      const spamIp = "198.51.100.99";

      // Report 1
      await graderService.submitGrader({ brandName: "B1", domain: "b1.example" }, spamIp);
      // Report 2
      await graderService.submitGrader({ brandName: "B2", domain: "b2.example" }, spamIp);
      // Report 3
      await graderService.submitGrader({ brandName: "B3", domain: "b3.example" }, spamIp);

      // Report 4 should fail with 429
      await expect(
        graderService.submitGrader({ brandName: "B4", domain: "b4.example" }, spamIp),
      ).rejects.toThrow(/Daily limit reached: Maximum 3 free reports per day per IP/);
    });

    it("enforces per-domain daily limit of 2 reports per day (HG-03)", async () => {
      const testDomain = "capped-domain.example";

      // 1st run
      await graderService.submitGrader(
        { brandName: "CapCo", domain: testDomain, forceRefresh: true },
        "198.51.100.10",
      );
      // 2nd run
      await graderService.submitGrader(
        { brandName: "CapCo", domain: testDomain, forceRefresh: true },
        "198.51.100.11",
      );

      // 3rd run for same domain should fail
      await expect(
        graderService.submitGrader({ brandName: "CapCo", domain: testDomain }, "198.51.100.12"),
      ).rejects.toThrow(/Daily limit reached: A free report has already been generated/);
    });
  });

  describe("7-Day Caching (HG-23)", () => {
    it("serves identical brand+domain+country submissions from cache within 7 days (HG-23)", async () => {
      const cacheDomain = "cached-audit.example";

      // Initial run
      const run1 = await graderService.submitGrader(
        { brandName: "CacheBrand", domain: cacheDomain, country: "US" },
        "198.51.100.20",
      );
      expect(run1.isCached).toBe(false);

      // Second submission should be instant cache hit
      const run2 = await graderService.submitGrader(
        { brandName: "CacheBrand", domain: cacheDomain, country: "US" },
        "198.51.100.21",
      );
      expect(run2.isCached).toBe(true);
      expect(run2.reportId).toBe(run1.reportId);
      expect(run2.shareToken).toBe(run1.shareToken);
    });
  });

  describe("Sharing, Email Capture & PDF Export (HG-21, HG-22)", () => {
    it("captures email with consent for report delivery (HG-21, HG-22)", async () => {
      await graderService.saveEmailCapture(createdShareToken, "founder@acmecloud.example", true);

      const reportRow = await f.database.query<{ email: string; email_opt_in: boolean }>(
        "SELECT email, email_opt_in FROM public.grader_reports WHERE share_token = $1",
        [createdShareToken],
      );

      expect(reportRow.rows[0].email).toBe("founder@acmecloud.example");
      expect(reportRow.rows[0].email_opt_in).toBe(true);
    });

    it("generates structured PDF data for printable report (HG-21)", async () => {
      const pdf = await graderService.getPdfData(createdShareToken);
      expect(pdf.title).toContain("AI Search Visibility Grade Report");
      expect(pdf.report.brandName).toBe("Acme Cloud");
      expect(pdf.report.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Convert to Monitored Project (HG-24, ONB-FR-013)", () => {
    it("imports Grader report data directly into M1 onboarding draft without data re-entry (HG-24, ONB-FR-013)", async () => {
      const conversion = await graderService.convertToProject(testUserId, createdShareToken);
      expect(conversion.success).toBe(true);
      expect(conversion.brandName).toBe("Acme Cloud");
      expect(conversion.promptsCount).toBeGreaterThanOrEqual(12);

      // Verify draft in onboarding_drafts
      const draftRes = await f.database.query<{ step: number; data: Record<string, unknown> }>(
        "SELECT step, data FROM public.onboarding_drafts WHERE user_id = $1",
        [testUserId],
      );

      expect(draftRes.rows.length).toBe(1);
      const draftData = draftRes.rows[0].data as {
        domain: string;
        brandProfile: { brandName: string };
        competitors: Array<{ name: string }>;
        prompts: Array<{ text: string }>;
        fromGraderToken: string;
      };
      expect(draftData.domain).toBe("acmecloud.example");
      expect(draftData.brandProfile.brandName).toBe("Acme Cloud");
      expect(draftData.competitors.length).toBe(2);
      expect(draftData.prompts.length).toBeGreaterThanOrEqual(12);
      expect(draftData.fromGraderToken).toBe(createdShareToken);

      // Verify grader_reports table updated with converted_at
      const reportRow = await f.database.query<{ converted_at: Date }>(
        "SELECT converted_at FROM public.grader_reports WHERE share_token = $1",
        [createdShareToken],
      );
      expect(reportRow.rows[0].converted_at).not.toBeNull();
    });
  });
});
