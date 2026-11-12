import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { LlmsValidator } from "../src/services/axo/llms-validator.js";
import {
  RobotsPolicyBuilder,
  SEARCH_ANSWER_BOTS,
  TRAINING_BOTS,
} from "../src/services/axo/robots-policy-builder.js";
import { DraftGenerator } from "../src/services/axo/draft-generator.js";
import { AxoService } from "../src/services/axo/axo.service.js";

describe("M16 Agent Experience Optimization (AXO-FR-001 to AXO-FR-010)", () => {
  const validator = new LlmsValidator();
  const policyBuilder = new RobotsPolicyBuilder();
  const draftGen = new DraftGenerator();

  describe("1. LLMS.txt Validator (AXO-FR-001, AXO-FR-002)", () => {
    it("validates a compliant llms.txt structure with high score", () => {
      const sampleLlms = `
# Acme Analytics
> Acme Analytics is an enterprise observability platform providing real-time data intelligence.

## Products & APIs
- [Metrics Engine](https://example.com/products/metrics): High-throughput time-series database and stream processing.
- [Alerting Service](https://example.com/products/alerts): Intelligent alerting and incident escalation policies.

## Documentation
- [Quickstart Guide](https://example.com/docs/quickstart): Getting started in under 5 minutes.
- [API Reference](https://example.com/docs/api): REST API documentation and authentication.

## Optional
- [Changelog](https://example.com/changelog): Weekly release notes and updates.
      `.trim();

      const result = validator.validate(sampleLlms, "example.com");

      expect(result.status).toBe("valid");
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.title).toBe("Acme Analytics");
      expect(result.summary).toContain("enterprise observability platform");
      expect(result.sections.length).toBeGreaterThanOrEqual(3);
      expect(result.totalLinks).toBe(5);
      expect(result.internalLinksCount).toBe(5);
      expect(result.externalLinksCount).toBe(0);
      expect(
        result.issues.filter((i) => i.severity === "critical" || i.severity === "high"),
      ).toHaveLength(0);
    });

    it("handles missing content gracefully with score 0", () => {
      const result = validator.validate("");
      expect(result.status).toBe("missing");
      expect(result.score).toBe(0);
      expect(result.issues[0]?.code).toBe("LLMS_EMPTY");
    });

    it("flags missing title and summary blockquote with warnings", () => {
      const invalidLlms = `
## Random Section
- [Some Link](https://example.com/link): A description here.
      `.trim();

      const result = validator.validate(invalidLlms, "example.com");
      expect(result.score).toBeLessThan(75);
      expect(result.issues.some((i) => i.code === "MISSING_TITLE")).toBe(true);
      expect(result.issues.some((i) => i.code === "MISSING_SUMMARY")).toBe(true);
    });

    it("flags malformed URLs in links", () => {
      const malformedLlms = `
# Acme Test
> Good summary blockquote.

## Section One
- [Broken Target](not-a-valid-url): Description of the link.
      `.trim();

      const result = validator.validate(malformedLlms, "example.com");
      expect(result.issues.some((i) => i.code === "INVALID_URL")).toBe(true);
      expect(result.brokenLinksCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("2. Robots.txt AI Policy Builder (AXO-FR-003, AXO-FR-004, AXO-FR-005)", () => {
    it("generates 'search_only' policy allowing search bots and blocking training bots", () => {
      const output = policyBuilder.generateRobotsTxt({
        preset: "search_only",
        domain: "example.com",
      });

      expect(output).toContain("Policy Preset: SEARCH_ONLY");

      // Verify search bots are allowed
      for (const bot of SEARCH_ANSWER_BOTS) {
        expect(output).toContain(`User-agent: ${bot.id}`);
      }
      expect(output).toContain("User-agent: OAI-SearchBot\nAllow: /");
      expect(output).toContain("User-agent: PerplexityBot\nAllow: /");
      expect(output).toContain("User-agent: Googlebot\nAllow: /");

      // Verify training bots are disallowed
      for (const bot of TRAINING_BOTS) {
        expect(output).toContain(`User-agent: ${bot.id}`);
      }
      expect(output).toContain("User-agent: GPTBot\nDisallow: /");
      expect(output).toContain("User-agent: Google-Extended\nDisallow: /");
      expect(output).toContain("User-agent: ClaudeBot\nDisallow: /");
      expect(output).toContain("User-agent: CCBot\nDisallow: /");

      // Includes discovery headers
      expect(output).toContain("Sitemap: https://example.com/sitemap.xml");
      expect(output).toContain("llms.txt: https://example.com/llms.txt");
    });

    it("generates 'maximum_visibility' policy allowing all bots", () => {
      const output = policyBuilder.generateRobotsTxt({
        preset: "maximum_visibility",
        domain: "example.com",
      });

      expect(output).toContain("MAXIMUM VISIBILITY PRESET");
      expect(output).toContain("User-agent: GPTBot\nAllow: /");
      expect(output).toContain("User-agent: OAI-SearchBot\nAllow: /");
      expect(output).not.toContain("Disallow: /");
    });

    it("generates 'strict_copyright' policy disallowing AI bots", () => {
      const output = policyBuilder.generateRobotsTxt({
        preset: "strict_copyright",
        domain: "example.com",
      });

      expect(output).toContain("STRICT COPYRIGHT PRESET");
      expect(output).toContain("User-agent: Googlebot\nAllow: /");
      expect(output).toContain("User-agent: Bingbot\nAllow: /");
      expect(output).toContain("User-agent: GPTBot\nDisallow: /");
      expect(output).toContain("User-agent: OAI-SearchBot\nDisallow: /");
    });

    it("compares existing robots.txt against proposed policy and computes diff", () => {
      const existing = `
User-agent: *
Disallow: /
      `.trim();

      const proposed = policyBuilder.generateRobotsTxt({
        preset: "search_only",
        domain: "example.com",
      });

      const comparison = policyBuilder.compareRobotsTxt(existing, proposed);

      expect(comparison.searchBotsAllowed).toBe(SEARCH_ANSWER_BOTS.length);
      expect(comparison.trainingBotsBlocked).toBe(TRAINING_BOTS.length);
      expect(comparison.diffs.length).toBe(SEARCH_ANSWER_BOTS.length + TRAINING_BOTS.length);

      const oaiSearch = comparison.diffs.find((d) => d.bot === "OAI-SearchBot");
      expect(oaiSearch?.existingStatus).toBe("disallowed");
      expect(oaiSearch?.proposedStatus).toBe("allowed");
      expect(oaiSearch?.hasChanged).toBe(true);

      const gptBot = comparison.diffs.find((d) => d.bot === "GPTBot");
      expect(gptBot?.existingStatus).toBe("disallowed");
      expect(gptBot?.proposedStatus).toBe("disallowed");
      expect(gptBot?.hasChanged).toBe(false);

      expect(comparison.netImpact).toContain("Optimal AI posture");
    });
  });

  describe("3. Draft Generator & Schema Synthesizer (AXO-FR-006, AXO-FR-007, AXO-FR-008)", () => {
    const brand = {
      brandName: "Acme Corp",
      domain: "acme.com",
      description: "Acme Corp builds enterprise observability and data analytics solutions.",
      aliases: ["Acme", "Acme Labs"],
      valueProposition: "Transform operational telemetry into actionable intelligence.",
    };

    const pages = [
      {
        url: "https://acme.com/docs/api",
        path: "/docs/api",
        title: "REST & Streaming API",
        description: "Programmatic interfaces for telemetry streams.",
        pageScore: 95,
        wordCount: 1200,
      },
      {
        url: "https://acme.com/products/metrics",
        path: "/products/metrics",
        title: "Metrics Engine",
        description: "Real-time metrics aggregator and querying.",
        pageScore: 92,
        wordCount: 850,
      },
      {
        url: "https://acme.com/guides/observability",
        path: "/guides/observability",
        title: "Observability Handbook",
        description: "Practical guide to distributed tracing.",
        pageScore: 88,
        wordCount: 2400,
      },
    ];

    it("generates specification-compliant /llms.txt", () => {
      const draft = draftGen.generateLlmsTxt(brand, pages);

      expect(draft).toContain("# Acme Corp");
      expect(draft).toContain("> Acme Corp builds enterprise observability");
      expect(draft).toContain("## Products & Core Services");
      expect(draft).toContain("- [Metrics Engine](https://acme.com/products/metrics)");
      expect(draft).toContain("## Documentation & Architecture");
      expect(draft).toContain("- [REST & Streaming API](https://acme.com/docs/api)");
      expect(draft).toContain("## Guides & Knowledge Base");
      expect(draft).toContain("- [Observability Handbook](https://acme.com/guides/observability)");

      // Validating generated draft with LLMSValidator should pass with high score
      const validation = validator.validate(draft, "acme.com");
      expect(validation.score).toBeGreaterThanOrEqual(85);
      expect(validation.status).toBe("valid");
    });

    it("generates comprehensive /llms-full.txt", () => {
      const fullDraft = draftGen.generateLlmsFullTxt(brand, pages);

      expect(fullDraft).toContain("# Acme Corp (Full Agent Documentation)");
      expect(fullDraft).toContain("## Overview & Value Proposition");
      expect(fullDraft).toContain("Also known as: Acme, Acme Labs.");
      expect(fullDraft).toContain("## Core Architecture & Technical Capabilities");
      expect(fullDraft).toContain("### REST & Streaming API");
      expect(fullDraft).toContain("## Knowledge Base & Frequently Asked Questions");
    });

    it("generates valid Schema.org JSON-LD templates", () => {
      const seedPrompts = ["What is Acme Corp?", "How does the metrics engine scale?"];
      const schemas = draftGen.generateJsonLdSchemas(brand, pages, seedPrompts);

      expect(schemas.organization["@type"]).toBe("Organization");
      expect(schemas.organization.name).toBe("Acme Corp");
      expect(schemas.organization.url).toBe("https://acme.com");

      expect(schemas.product["@type"]).toBe("Product");
      expect(schemas.product.name).toBe("Acme Corp Platform");

      expect(schemas.faqPage["@type"]).toBe("FAQPage");
      const entities = schemas.faqPage.mainEntity as Array<{ name: string }>;
      expect(entities.length).toBeGreaterThanOrEqual(2);
      expect(entities.some((e) => e.name === "What is Acme Corp?")).toBe(true);

      expect(schemas.article["@type"]).toBe("TechArticle");
      expect(schemas.article.headline).toContain("Acme Corp Technical Overview");
    });
  });

  describe("4. AxoService Integration", () => {
    it("returns default policy if no record exists yet", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation((queryText: string) => {
          if (queryText.includes("FROM public.projects")) {
            return Promise.resolve({
              rows: [
                {
                  id: "proj-1",
                  brandName: "Test Brand",
                  domain: "testbrand.com",
                  description: "A test platform",
                  aliases: [],
                },
              ],
            });
          }
          if (queryText.includes("FROM public.agent_policies")) {
            return Promise.resolve({ rows: [] });
          }
          if (queryText.includes("FROM public.technical_audit_pages")) {
            return Promise.resolve({ rows: [] });
          }
          if (queryText.includes("FROM public.monitoring_prompts")) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as Pool;

      const service = new AxoService(mockPool);
      const policy = await service.getPolicy("tenant-1", "proj-1");

      expect(policy.policyPreset).toBe("search_only");
      expect(policy.robotsTxtContent).toContain("Policy Preset: SEARCH_ONLY");
      expect(policy.llmsTxtDraft).toContain("# Test Brand");
      expect(policy.trainingBotsDisallowed).toBe(true);
      expect(policy.searchBotsAllowed).toBe(true);
    });

    it("saves and persists policy in database", async () => {
      const mockSaved = {
        id: "policy-123",
        tenantId: "tenant-1",
        projectId: "proj-1",
        policyPreset: "search_only",
        robotsTxtContent: "User-agent: *\nDisallow: /",
        botRules: {},
        trainingBotsDisallowed: true,
        searchBotsAllowed: true,
        customDirectives: null,
        llmsTxtDraft: "# Draft",
        llmsFullTxtDraft: null,
        llmsValidation: {},
        schemaTemplates: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockPool = {
        query: vi.fn().mockImplementation((queryText: string) => {
          if (queryText.includes("FROM public.projects")) {
            return Promise.resolve({
              rows: [
                {
                  id: "proj-1",
                  brandName: "Test Brand",
                  domain: "testbrand.com",
                  description: "A test platform",
                  aliases: [],
                },
              ],
            });
          }
          if (queryText.includes("SELECT id FROM public.agent_policies")) {
            return Promise.resolve({ rows: [] });
          }
          if (queryText.includes("INSERT INTO public.agent_policies")) {
            return Promise.resolve({ rows: [mockSaved] });
          }
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as Pool;

      const service = new AxoService(mockPool);
      const saved = await service.savePolicy("tenant-1", "proj-1", {
        robotsTxtContent: "User-agent: *\nDisallow: /",
      });

      expect(saved.id).toBe("policy-123");
      expect(saved.robotsTxtContent).toBe("User-agent: *\nDisallow: /");
    });
  });
});
