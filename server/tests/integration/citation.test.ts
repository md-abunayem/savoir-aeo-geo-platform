import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { CitationService } from "../../src/services/analytics/citation.service.js";

let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let citationService: CitationService;

const ownerId = randomUUID();
const tenantId = randomUUID();
const projectId = randomUUID();
const competitorId = randomUUID();
const promptId1 = randomUUID();
const promptId2 = randomUUID();
const runId1 = randomUUID();
const runId2 = randomUUID();

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
     VALUES ($1, 'citation-tester@example.com', 'Citation Tester', 'hash', now()),
            ($2, 'other-tester@example.com', 'Other Tester', 'hash', now())`,
    [ownerId, otherUserId],
  );

  await f.database.query(
    `INSERT INTO tenants (id, name, region) 
     VALUES ($1, 'Citation Main Tenant', 'us'),
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
     VALUES ($1, $2, $3, 'What are the best GEO visibility tools?', 'SEO Lead', 1, true),
            ($4, $2, $3, 'Compare Savoir AI vs ApexScale for answer optimization', 'Director', 1, true)`,
    [promptId1, tenantId, projectId, promptId2],
  );

  // 2. Seed monitoring runs, answers, and citations
  // Run 1: Brand is cited (savoir.io) and G2 is cited
  const ansId1 = randomUUID();
  await f.database.query(
    `INSERT INTO monitoring_runs (id, tenant_id, project_id, batch_key, item_key, request, status, created_at, completed_at)
     VALUES ($1, $2, $3, 'batch_1', 'item_1', $4, 'succeeded', now() - interval '2 hours', now())`,
    [
      runId1,
      tenantId,
      projectId,
      JSON.stringify({ engine: "openai", promptId: promptId1, geo: "US", language: "en" }),
    ],
  );
  await f.database.query(
    `INSERT INTO answers (id, tenant_id, project_id, run_id, prompt_id, engine, geo, language, text, text_hash, has_citations)
     VALUES ($1, $2, $3, $4, $5, 'openai', 'US', 'en', 'Savoir AI overview text', 'hash_1', true)`,
    [ansId1, tenantId, projectId, runId1, promptId1],
  );
  await f.database.query(
    `INSERT INTO citations (id, tenant_id, project_id, answer_id, url, normalized_url, domain, source_type)
     VALUES ($1, $2, $3, $4, 'https://savoir.io/product', 'https://savoir.io/product', 'savoir.io', 'brand'),
            ($5, $2, $3, $4, 'https://www.g2.com/products/savoir-ai/reviews', 'https://www.g2.com/products/savoir-ai/reviews', 'g2.com', 'review_comparison')`,
    [randomUUID(), tenantId, projectId, ansId1, randomUUID()],
  );

  // Run 2: Competitor is cited (apexscale.com) and TechRadar is cited, brand is NOT cited -> GAP RUN
  const ansId2 = randomUUID();
  await f.database.query(
    `INSERT INTO monitoring_runs (id, tenant_id, project_id, batch_key, item_key, request, status, created_at, completed_at)
     VALUES ($1, $2, $3, 'batch_2', 'item_2', $4, 'succeeded', now() - interval '1 hour', now())`,
    [
      runId2,
      tenantId,
      projectId,
      JSON.stringify({ engine: "gemini", promptId: promptId2, geo: "US", language: "en" }),
    ],
  );
  await f.database.query(
    `INSERT INTO answers (id, tenant_id, project_id, run_id, prompt_id, engine, geo, language, text, text_hash, has_citations)
     VALUES ($1, $2, $3, $4, $5, 'gemini', 'US', 'en', 'ApexScale review text', 'hash_2', true)`,
    [ansId2, tenantId, projectId, runId2, promptId2],
  );
  await f.database.query(
    `INSERT INTO mentions (id, tenant_id, project_id, answer_id, entity_type, entity_id, entity_name, matched_text, position_index, list_rank, sentiment, confidence, snippet)
     VALUES ($1, $2, $3, $4, 'competitor', $5, 'ApexScale', 'ApexScale', 10, 1, 1, '0.900', 'ApexScale is leading')`,
    [randomUUID(), tenantId, projectId, ansId2, competitorId],
  );
  await f.database.query(
    `INSERT INTO citations (id, tenant_id, project_id, answer_id, url, normalized_url, domain, source_type)
     VALUES ($1, $2, $3, $4, 'https://apexscale.com/pricing', 'https://apexscale.com/pricing', 'apexscale.com', 'competitor'),
            ($5, $2, $3, $4, 'https://www.techradar.com/best/seo-tools', 'https://www.techradar.com/best/seo-tools', 'techradar.com', 'news_media')`,
    [randomUUID(), tenantId, projectId, ansId2, randomUUID()],
  );

  // Run 3: Wikipedia and G2 cited on second gap run
  const runId3 = randomUUID();
  const ansId3 = randomUUID();
  await f.database.query(
    `INSERT INTO monitoring_runs (id, tenant_id, project_id, batch_key, item_key, request, status, created_at, completed_at)
     VALUES ($1, $2, $3, 'batch_3', 'item_3', $4, 'succeeded', now() - interval '30 minutes', now())`,
    [
      runId3,
      tenantId,
      projectId,
      JSON.stringify({ engine: "openai", promptId: promptId2, geo: "US", language: "en" }),
    ],
  );
  await f.database.query(
    `INSERT INTO answers (id, tenant_id, project_id, run_id, prompt_id, engine, geo, language, text, text_hash, has_citations)
     VALUES ($1, $2, $3, $4, $5, 'openai', 'US', 'en', 'Third party analysis', 'hash_3', true)`,
    [ansId3, tenantId, projectId, runId3, promptId2],
  );
  await f.database.query(
    `INSERT INTO mentions (id, tenant_id, project_id, answer_id, entity_type, entity_id, entity_name, matched_text, position_index, list_rank, sentiment, confidence, snippet)
     VALUES ($1, $2, $3, $4, 'competitor', $5, 'ApexScale', 'ApexScale', 10, 1, 1, '0.900', 'ApexScale alternative')`,
    [randomUUID(), tenantId, projectId, ansId3, competitorId],
  );
  await f.database.query(
    `INSERT INTO citations (id, tenant_id, project_id, answer_id, url, normalized_url, domain, source_type)
     VALUES ($1, $2, $3, $4, 'https://apexscale.com/docs', 'https://apexscale.com/docs', 'apexscale.com', 'competitor'),
            ($5, $2, $3, $4, 'https://www.g2.com/categories/seo-analytics', 'https://www.g2.com/categories/seo-analytics', 'g2.com', 'review_comparison'),
            ($6, $2, $3, $4, 'https://en.wikipedia.org/wiki/Search_engine_optimization', 'https://en.wikipedia.org/wiki/Search_engine_optimization', 'wikipedia.org', 'encyclopedia')`,
    [randomUUID(), tenantId, projectId, ansId3, randomUUID(), randomUUID()],
  );

  // Setup mock fetcher for broken URL detection test
  const mockFetcher: typeof fetch = async (input, _init) => {
    const urlStr = String(input);
    if (urlStr.includes("broken-link")) {
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    }
    if (urlStr.includes("redirect-link")) {
      const headers = new Headers();
      headers.set("Location", "https://savoir.io/new-destination");
      return new Response(null, { status: 301, headers });
    }
    return new Response("OK", { status: 200, statusText: "OK" });
  };

  citationService = new CitationService(f.database, mockFetcher);
});

afterAll(async () => {
  await f?.close();
});

describe("CitationService Integration Tests (CIT-FR-001 to CIT-FR-011)", () => {
  describe("Citation Overview & Distribution (CIT-FR-001 to 004)", () => {
    it("computes accurate citation counts, shares, source type distributions, and brand pages", async () => {
      const overview = await citationService.getCitationOverview(context, projectId, { days: 7 });

      expect(overview.project.brandName).toBe("Savoir AI");
      expect(overview.summary.totalCitationsCount).toBe(7); // 2 + 2 + 3 citations
      expect(overview.summary.uniqueDomainsCount).toBeGreaterThanOrEqual(4);

      // Brand citation rate: 1 run out of 3 runs cited brand -> 33.3%
      expect(overview.summary.brandCitationRate.value).toBeCloseTo(0.3333, 2);
      expect(overview.summary.brandCitationRate.label).toBe("Observed");
      expect(overview.summary.brandCitationRate.n).toBe(3);

      // Source type distribution
      const dist = overview.summary.sourceTypeDistribution;
      expect(dist["review_comparison"]).toBeDefined();
      expect(dist["review_comparison"].count).toBe(2); // G2 cited twice
      expect(dist["news_media"]).toBeDefined();
      expect(dist["competitor"]).toBeDefined();

      // Top domains
      expect(overview.topDomains.length).toBeGreaterThan(0);
      const g2 = overview.topDomains.find((d) => d.domain === "g2.com");
      expect(g2).toBeDefined();
      expect(g2?.citationCount).toBe(2);
      expect(g2?.sourceType).toBe("review_comparison");

      // Brand pages
      expect(overview.brandPages.length).toBe(1);
      expect(overview.brandPages[0].url).toBe("https://savoir.io/product");
      expect(overview.brandPages[0].isBrandPage).toBe(true);
    });

    it("enforces tenant isolation and rejects unauthorized tenant access", async () => {
      await expect(citationService.getCitationOverview(otherContext, projectId)).rejects.toThrow(
        "Project not found or access denied",
      );
    });
  });

  describe("Domain & Page Citations (CIT-FR-003, CIT-FR-006)", () => {
    it("lists domain citations with distinct pages count, engines, and competitor attribution", async () => {
      const domains = await citationService.listDomainCitations(context, projectId, { days: 7 });
      expect(domains.length).toBeGreaterThan(0);

      const compDomain = domains.find((d) => d.domain === "apexscale.com");
      expect(compDomain).toBeDefined();
      expect(compDomain?.citesCompetitors).toContain("ApexScale");
    });

    it("lists page citations with prompts count and brand page indicator", async () => {
      const pages = await citationService.listPageCitations(context, projectId, { days: 7 });
      expect(pages.length).toBeGreaterThan(0);

      const brandPage = pages.find((p) => p.isBrandPage);
      expect(brandPage).toBeDefined();
      expect(brandPage?.url).toBe("https://savoir.io/product");
    });
  });

  describe("Citation Gap Analysis (CIT-FR-005, Feature CIT-F1 & CIT-FR-008)", () => {
    it("identifies citations awarded to competitors where brand is missing and computes opportunity score", async () => {
      const gaps = await citationService.getCitationGaps(context, projectId, { days: 7 });

      // Run 2 and Run 3 cited ApexScale without Savoir AI
      // Cited third-party sources: g2.com and techradar.com and wikipedia.org
      expect(gaps.length).toBeGreaterThanOrEqual(2);

      const g2Gap = gaps.find((g) => g.domain === "g2.com");
      expect(g2Gap).toBeDefined();
      expect(g2Gap?.gapRunsCount).toBe(1);
      expect(g2Gap?.competitorNames).toContain("ApexScale");
      expect(g2Gap?.opportunityScore).toBeGreaterThan(0);
      expect(g2Gap?.suggestedAction).toContain("review request");

      const techRadarGap = gaps.find((g) => g.domain === "techradar.com");
      expect(techRadarGap).toBeDefined();
      expect(techRadarGap?.sourceType).toBe("news_media");
      expect(techRadarGap?.suggestedAction).toContain("editorial");

      // Verify opportunities were cached in citation_opportunities table
      const cached = await f.database.query(
        `SELECT * FROM public.citation_opportunities WHERE project_id = $1`,
        [projectId],
      );
      expect(cached.rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Broken Brand Citation Detection (CIT-FR-009)", () => {
    it("detects 4xx broken links and 3xx redirects on brand cited URLs and creates tasks", async () => {
      // Seed a broken brand citation and a redirect brand citation
      const brokenRunId = randomUUID();
      await f.database.query(
        `INSERT INTO monitoring_runs (id, tenant_id, project_id, batch_key, item_key, request, status, created_at, completed_at)
         VALUES ($1, $2, $3, 'batch_broken', 'item_broken', $4, 'succeeded', now(), now())`,
        [
          brokenRunId,
          tenantId,
          projectId,
          JSON.stringify({ engine: "openai", promptId: promptId1, geo: "US", language: "en" }),
        ],
      );

      const brokenAnsId = randomUUID();
      await f.database.query(
        `INSERT INTO answers (id, tenant_id, project_id, run_id, engine, text, text_hash, has_citations)
         VALUES ($1, $2, $3, $4, 'openai', 'Broken answer', 'hash_broken', true)`,
        [brokenAnsId, tenantId, projectId, brokenRunId],
      );

      await f.database.query(
        `INSERT INTO citations (id, tenant_id, project_id, answer_id, url, normalized_url, domain, source_type)
         VALUES ($1, $2, $3, $4, 'https://savoir.io/broken-link', 'https://savoir.io/broken-link', 'savoir.io', 'brand'),
                ($5, $2, $3, $4, 'https://savoir.io/redirect-link', 'https://savoir.io/redirect-link', 'savoir.io', 'brand')`,
        [randomUUID(), tenantId, projectId, brokenAnsId, randomUUID()],
      );

      // Run live detection with mock fetcher
      const detection = await citationService.detectBrokenBrandCitations(context, projectId, {
        checkLive: true,
      });

      expect(detection.checkedCount).toBeGreaterThanOrEqual(2);
      expect(detection.brokenCount).toBeGreaterThanOrEqual(2);

      const brokenList = await citationService.listBrokenCitations(context, projectId);
      expect(brokenList.length).toBeGreaterThanOrEqual(2);

      const broken404 = brokenList.find((b) => b.statusCode === 404);
      expect(broken404).toBeDefined();
      expect(broken404?.taskStatus).toBe("open");

      const redirected301 = brokenList.find((b) => b.statusCode === 301);
      expect(redirected301).toBeDefined();
      expect(redirected301?.redirectUrl).toBe("https://savoir.io/new-destination");

      // Update task status to resolved
      const resolved = await citationService.updateBrokenCitationStatus(
        context,
        projectId,
        broken404!.id,
        "resolved",
      );
      expect(resolved.taskStatus).toBe("resolved");
    });
  });

  describe("Source Domain Rules & Overrides (CIT-FR-010)", () => {
    let sourceId: string;

    it("upserts and deletes domain classification overrides and allow/deny rules", async () => {
      const created = await citationService.upsertSourceDomain(context, projectId, {
        domain: "specialized-blog.org",
        sourceType: "documentation_blog",
        isAllowed: true,
        isDenied: false,
        notes: "High authority technical blog",
      });

      expect(created.id).toBeDefined();
      expect(created.domain).toBe("specialized-blog.org");
      expect(created.sourceType).toBe("documentation_blog");
      sourceId = created.id;

      const list = await citationService.listSourceDomains(context, projectId);
      expect(list.some((s) => s.id === sourceId)).toBe(true);

      const del = await citationService.deleteSourceDomain(context, projectId, sourceId);
      expect(del.success).toBe(true);
    });
  });

  describe("CSV Export (CIT-FR-011)", () => {
    it("exports domains, pages, gaps, and broken citations in valid CSV format", async () => {
      const domainsCsv = await citationService.exportCsv(context, projectId, "domains");
      expect(domainsCsv).toContain("Domain,SourceType,CitationCount,CitationShare");
      expect(domainsCsv).toContain("g2.com");

      const pagesCsv = await citationService.exportCsv(context, projectId, "pages");
      expect(pagesCsv).toContain("URL,NormalizedURL,Domain,SourceType");

      const gapsCsv = await citationService.exportCsv(context, projectId, "gaps");
      expect(gapsCsv).toContain("Domain,PageURL,SourceType,GapRunsCount,OpportunityScore");

      const brokenCsv = await citationService.exportCsv(context, projectId, "broken");
      expect(brokenCsv).toContain("URL,NormalizedURL,Domain,StatusCode,RedirectURL");
    });
  });
});
