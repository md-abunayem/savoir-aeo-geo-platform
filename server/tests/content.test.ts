import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { ContentClusteringEngine } from "../src/services/content/content-clustering.js";
import { ContentScorer } from "../src/services/content/content-scorer.js";
import { ContentBriefGenerator } from "../src/services/content/content-brief-generator.js";
import { ContentService } from "../src/services/content/content.service.js";

describe("M9 Content Intelligence (CNT-FR-001 to CNT-FR-009)", () => {
  const clusteringEngine = new ContentClusteringEngine();
  const scorer = new ContentScorer();
  const briefGenerator = new ContentBriefGenerator();

  describe("1. Semantic Clustering & Mapping (CNT-FR-001, CNT-FR-006, CNT-FR-007)", () => {
    it("vectorizes text and calculates cosine similarity accurately", () => {
      const v1 = clusteringEngine.vectorize("enterprise observability time series metrics");
      const v2 = clusteringEngine.vectorize("enterprise metrics observability platform");
      const v3 = clusteringEngine.vectorize("organic cotton pet supplies dogs");

      const simHigh = clusteringEngine.cosineSimilarity(v1, v2);
      const simLow = clusteringEngine.cosineSimilarity(v1, v3);

      expect(simHigh).toBeGreaterThan(0.5);
      expect(simLow).toBeLessThan(0.15);
    });

    it("groups related prompts into clusters", () => {
      const prompts = [
        { id: "p1", body: "What is enterprise distributed tracing?" },
        { id: "p2", body: "How to configure distributed tracing in microservices?" },
        { id: "p3", body: "Best cloud cost optimization tools" },
        { id: "p4", body: "How to reduce AWS cloud infrastructure costs?" },
      ];

      const clusters = clusteringEngine.clusterPrompts(prompts, 0.35);
      expect(clusters.length).toBeGreaterThanOrEqual(2);

      // Verify distributed tracing prompts clustered together
      const tracingCluster = clusters.find((c) =>
        c.prompts.some((p) => p.body.includes("distributed tracing")),
      );
      expect(tracingCluster).toBeDefined();
      expect(tracingCluster?.prompts.length).toBeGreaterThanOrEqual(2);
    });

    it("maps pages to prompts and detects cannibalization and staleness", () => {
      const ninetyFiveDaysAgo = new Date(Date.now() - 95 * 24 * 3600 * 1000).toISOString();

      const pages = [
        {
          url: "https://example.com/docs/tracing-overview",
          path: "/docs/tracing-overview",
          title: "Distributed Tracing Architecture Overview",
          lastModified: ninetyFiveDaysAgo, // stale
        },
        {
          url: "https://example.com/blog/distributed-tracing-guide",
          path: "/blog/distributed-tracing-guide",
          title: "Complete Guide to Distributed Tracing",
          lastModified: new Date().toISOString(), // fresh
        },
      ];

      const prompts = [{ id: "p1", body: "Distributed tracing guide and overview" }];

      const { mappings, cannibalizationIssues } = clusteringEngine.mapPagesToPrompts(
        pages,
        prompts,
        {
          similarityThreshold: 0.4,
          staleThresholdDays: 90,
          cannibalizationThreshold: 0.45,
        },
      );

      expect(mappings).toHaveLength(2);
      expect(mappings[0]!.mappedPromptIds).toContain("p1");
      expect(mappings[0]!.isStale).toBe(true);

      // Cannibalization detected (both pages strongly match p1)
      expect(cannibalizationIssues.length).toBeGreaterThanOrEqual(1);
      expect(cannibalizationIssues[0]!.promptId).toBe("p1");
      expect(cannibalizationIssues[0]!.competingPages.length).toBe(2);
    });
  });

  describe("2. AEO Content Scorer & Page Comparison (CNT-FR-003, CNT-FR-004)", () => {
    it("computes comprehensive page-level AEO Content Score", () => {
      const input = {
        url: "https://example.com/guide",
        path: "/guide",
        title: "Enterprise Observability",
        metaDescription: "Guide to telemetry and log aggregation.",
        rawText: `
          Enterprise Observability is a unified framework for distributed telemetry. In summary, it aggregates traces, metrics, and logs.
          According to research from IEEE, systems achieve 99.9% reliability with 45% faster incident resolution times.
          Source: Published in ACM Computing Surveys.
          - Metric Pipelines
          - Alerting Escalations
          - Distributed Traces
        `,
        hasAnswerFirst: true,
        hasFaqBlocks: true,
        wordCount: 850,
        outboundLinksCount: 4,
        schemasDetected: [{ type: "Article" }, { type: "FAQPage" }],
        hasAuthorMetadata: true,
        lastModified: new Date().toISOString(),
      };

      const breakdown = scorer.scorePage(input);

      expect(breakdown.label).toBe("Modeled");
      expect(breakdown.contentScore).toBeGreaterThanOrEqual(80);
      expect(breakdown.answerFirstScore).toBe(25);
      expect(breakdown.entityClarityScore).toBeGreaterThanOrEqual(10);
      expect(breakdown.citationsScore).toBe(15);
      expect(breakdown.schemaScore).toBe(10);
      expect(breakdown.strengths.length).toBeGreaterThan(0);
    });

    it("compares owned page against competitor page with concrete differences", () => {
      const owned = {
        url: "https://example.com/product",
        path: "/product",
        title: "Our Product",
        wordCount: 400,
        rawText: "Our product provides monitoring.",
      };

      const competitor = {
        url: "https://competitor.com/product",
        path: "/product",
        title: "Competitor Suite",
        wordCount: 1500,
        hasAnswerFirst: true,
        hasFaqBlocks: true,
        schemasDetected: [{ type: "Product" }, { type: "FAQPage" }],
        rawText: "Kubernetes container telemetry with latency benchmarks and pricing tiers.",
      };

      const comparison = scorer.compareAgainstCitedPage(owned, competitor, [
        "What is container telemetry?",
      ]);

      expect(comparison.wordCountDelta).toBe(-1100);
      expect(comparison.structuralDifferences.length).toBeGreaterThan(0);
      expect(comparison.competitorScore).toBeGreaterThan(comparison.ownedScore);
      expect(comparison.actionableSummary).toContain("https://competitor.com/product");
    });
  });

  describe("3. Content Brief Generator (CNT-FR-005, CNT-FR-008, CNT-FR-009)", () => {
    it("synthesizes editable content brief with all required sections and disclaimer", () => {
      const brief = briefGenerator.generateBrief({
        title: "AEO Optimization Blueprint",
        targetPrompts: ["How to optimize content for AI search engines?"],
        primaryIntent: "informational",
        brandName: "Acme",
        brandDomain: "acme.com",
        competitorCitations: ["searchengineland.com", "searchenginejournal.com"],
      });

      expect(brief.label).toBe("Estimated");
      expect(brief.disclaimer).toContain("CNT-FR-009");
      expect(brief.targetPrompts).toHaveLength(1);
      expect(brief.questionsToAnswer.length).toBeGreaterThanOrEqual(2);
      expect(brief.suggestedOutline.length).toBeGreaterThanOrEqual(3);
      expect(brief.targetEntities.length).toBeGreaterThanOrEqual(3);
      expect(brief.recommendedSchemas).toContain("FAQPage");
      expect(brief.markdownContent).toContain("# Content Brief:");
      expect(brief.markdownContent).toContain("## 2. Questions to Answer (FAQ / PAA Blocks)");
    });

    it("generates Microsoft Word-compatible HTML format", () => {
      const brief = briefGenerator.generateBrief({
        title: "Cloud Migration Brief",
        targetPrompts: ["Cloud migration best practices"],
        brandName: "Acme",
        brandDomain: "acme.com",
      });

      const docxHtml = briefGenerator.generateDocxHtml(brief);

      expect(docxHtml).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"');
      expect(docxHtml).toContain("Cloud Migration Brief - Content Brief");
      expect(docxHtml).toContain("Notice (CNT-FR-009):");
      expect(docxHtml).toContain("Recommended Content Outline");
    });
  });

  describe("4. ContentService Integration", () => {
    it("identifies content gaps when brand visibility and content overlap are low", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation((queryText: string) => {
          if (queryText.includes("FROM public.projects")) {
            return Promise.resolve({
              rows: [{ id: "proj-1", brandName: "Acme", domain: "acme.com" }],
            });
          }
          if (queryText.includes("FROM public.monitoring_prompts")) {
            return Promise.resolve({
              rows: [
                {
                  id: "prompt-101",
                  body: "Kubernetes zero trust network mesh security",
                  brandVis: 0.1,
                  demandIndex: 80,
                  promptWeight: 1.0,
                },
              ],
            });
          }
          if (queryText.includes("FROM public.content_items")) {
            return Promise.resolve({
              rows: [
                {
                  url: "https://acme.com/about",
                  path: "/about",
                  title: "About Acme",
                  metaDescription: "Company history.",
                },
              ],
            });
          }
          if (queryText.includes("FROM public.citations")) {
            return Promise.resolve({ rows: [{ domain: "competitor.com" }] });
          }
          if (queryText.includes("INSERT INTO public.content_gaps")) {
            return Promise.resolve({ rows: [] });
          }
          if (queryText.includes("FROM public.content_gaps")) {
            return Promise.resolve({ rows: [{ total: 1 }] });
          }
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as Pool;

      const service = new ContentService(mockPool);
      const result = await service.identifyContentGaps("tenant-1", "proj-1");

      expect(result.newGapsCount).toBe(1);
      expect(result.totalGaps).toBe(1);
    });

    it("creates, retrieves and exports a content brief", async () => {
      const mockSavedBrief = {
        id: "brief-1",
        tenantId: "tenant-1",
        projectId: "proj-1",
        gapId: null,
        title: "Test Brief",
        targetPrompts: ["Test prompt"],
        primaryIntent: "informational",
        questionsToAnswer: ["Q1"],
        suggestedOutline: [],
        targetEntities: [],
        factsAndStatistics: [],
        recommendedSchemas: [],
        internalLinkingSuggestions: [],
        sourcesToCite: [],
        markdownContent: "# Test Brief",
        status: "draft",
        label: "Estimated",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockPool = {
        query: vi.fn().mockImplementation((queryText: string) => {
          if (queryText.includes("FROM public.projects")) {
            return Promise.resolve({
              rows: [{ id: "proj-1", brandName: "Acme", domain: "acme.com" }],
            });
          }
          if (queryText.includes("FROM public.content_items")) {
            return Promise.resolve({ rows: [] });
          }
          if (queryText.includes("FROM public.citations")) {
            return Promise.resolve({ rows: [] });
          }
          if (queryText.includes("INSERT INTO public.content_briefs")) {
            return Promise.resolve({ rows: [mockSavedBrief] });
          }
          if (queryText.includes("FROM public.content_briefs")) {
            return Promise.resolve({ rows: [mockSavedBrief] });
          }
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as Pool;

      const service = new ContentService(mockPool);
      const brief = await service.createBrief("tenant-1", "proj-1", {
        title: "Test Brief",
        targetPrompts: ["Test prompt"],
      });

      expect(brief.id).toBe("brief-1");

      const exportedMd = await service.exportBrief("tenant-1", "proj-1", "brief-1", "markdown");
      expect(exportedMd.contentType).toContain("text/markdown");
      expect(exportedMd.filename).toBe("test-brief.md");

      const exportedDocx = await service.exportBrief("tenant-1", "proj-1", "brief-1", "docx");
      expect(exportedDocx.contentType).toContain("application/vnd.openxmlformats-officedocument");
      expect(exportedDocx.filename).toBe("test-brief.docx");
    });
  });
});
