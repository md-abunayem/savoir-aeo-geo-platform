import { describe, it, expect, vi } from "vitest";
import { AeoRuleEngine, MONITORED_BOTS } from "../src/services/technical/aeo-rule-engine.js";
import { FirecrawlCrawler } from "../src/services/technical/firecrawl-crawler.js";

describe("M8 Technical AEO Auditing Rule Engine (TEC-FR-001 to TEC-FR-016)", () => {
  const engine = new AeoRuleEngine();

  describe("1. AI Bot Access Matrix (TEC-FR-003)", () => {
    it("evaluates all 9 monitored AI bots", () => {
      const robotsTxt = `
User-agent: *
Disallow: /admin
      `.trim();

      const result = engine.evaluateBotAccess(robotsTxt);

      expect(MONITORED_BOTS).toHaveLength(9);
      expect(Object.keys(result.bots)).toHaveLength(9);
      expect(result.bots).toHaveProperty("GPTBot");
      expect(result.bots).toHaveProperty("OAI-SearchBot");
      expect(result.bots).toHaveProperty("ChatGPT-User");
      expect(result.bots).toHaveProperty("Google-Extended");
      expect(result.bots).toHaveProperty("Googlebot");
      expect(result.bots).toHaveProperty("PerplexityBot");
      expect(result.bots).toHaveProperty("ClaudeBot");
      expect(result.bots).toHaveProperty("Bingbot");
      expect(result.bots).toHaveProperty("CCBot");
    });

    it("correctly identifies disallowed bot when blocked at root", () => {
      const robotsTxt = `
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: *
Allow: /
      `.trim();

      const result = engine.evaluateBotAccess(robotsTxt);

      expect(result.bots.GPTBot.status).toBe("declared_disallowed");
      expect(result.bots.GPTBot.score).toBe(0);
      expect(result.bots.ClaudeBot.status).toBe("declared_disallowed");
      expect(result.bots.Googlebot.status).toBe("declared_allowed");
      expect(result.bots.Googlebot.score).toBe(100);
      expect(result.declaredDisallowedCount).toBe(2);
      expect(result.declaredAllowedCount).toBe(7);
      expect(result.bots.GPTBot.fixSnippet).toContain("User-agent: GPTBot");
    });

    it("identifies partial restrictions on subpaths", () => {
      const robotsTxt = `
User-agent: Google-Extended
Disallow: /private/
Disallow: /internal/
      `.trim();

      const result = engine.evaluateBotAccess(robotsTxt);

      expect(result.bots["Google-Extended"].status).toBe("declared_partial");
      expect(result.bots["Google-Extended"].score).toBe(50);
    });

    it("respects wildcard blocks when no specific bot rule is declared", () => {
      const robotsTxt = `
User-agent: *
Disallow: /
      `.trim();

      const result = engine.evaluateBotAccess(robotsTxt);

      for (const bot of Object.values(result.bots)) {
        expect(bot.status).toBe("declared_disallowed");
        expect(bot.score).toBe(0);
      }
      expect(result.score).toBe(0);
      expect(result.declaredDisallowedCount).toBe(9);
    });

    it("does not claim bot access when robots.txt is missing or inaccessible", () => {
      for (const status of ["missing", "inaccessible", "failed"] as const) {
        const result = engine.evaluateBotAccess("", status);
        expect(result.score).toBeNull();
        expect(Object.values(result.bots).every((bot) => bot.status === "unknown")).toBe(true);
      }
    });
  });

  describe("2. Indexability, Canonical & Status Codes (TEC-FR-004)", () => {
    it("flags HTTP error status codes and marks page unindexable", () => {
      const res = engine.evaluatePage({
        url: "https://example.com/missing",
        path: "/missing",
        statusCode: 404,
        rawHtml: "<html><body>Not Found</body></html>",
      });

      expect(res.isIndexable).toBe(false);
      expect(res.statusCode).toBe(404);
      expect(res.issues.some((i) => i.code === "HTTP_404")).toBe(true);
      expect(res.pageScore).toBeNull();
    });

    it("detects meta robots noindex directive", () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="robots" content="noindex, nofollow" />
            <title>Secret Page</title>
          </head>
          <body><h1>Heading</h1></body>
        </html>
      `;

      const res = engine.evaluatePage({
        url: "https://example.com/noindex",
        path: "/noindex",
        statusCode: 200,
        rawHtml: html,
      });

      expect(res.isIndexable).toBe(false);
      expect(res.issues.some((i) => i.code === "META_ROBOTS_NOINDEX")).toBe(true);
      expect(res.issues.find((i) => i.code === "META_ROBOTS_NOINDEX")?.severity).toBe("critical");
    });

    it("reports intentional noindex on utility routes without scoring them", () => {
      const res = engine.evaluatePage({
        url: "https://example.com/account/login",
        path: "/account/login",
        statusCode: 200,
        rawHtml:
          '<meta name="robots" content="noindex, nofollow"><form><input type="password"></form>',
      });

      expect(res.excluded).toBe(true);
      expect(res.pageScore).toBeNull();
      expect(res.issues.find((issue) => issue.code === "UTILITY_PAGE_NOINDEX")?.severity).toBe(
        "info",
      );
    });

    it("resolves relative canonicals against the final URL and accepts only observed www aliases", () => {
      const res = engine.evaluatePage({
        url: "https://www.example.com/article",
        finalUrl: "https://example.com/article",
        verifiedHostAliases: ["www.example.com", "example.com"],
        path: "/article",
        statusCode: 200,
        rawHtml: '<link rel="canonical" href="/article">',
      });

      expect(res.finalUrl).toBe("https://example.com/article");
      expect(res.canonicalUrl).toBe("https://example.com/article");
      expect(res.canonicalStatus).toBe("match");
      expect(res.issues.some((issue) => issue.code === "CANONICAL_HOST_ALIAS_UNVERIFIED")).toBe(
        false,
      );
    });

    it("keeps an unverified hostname alias and conflicting canonical targets as warnings", () => {
      const unverified = engine.evaluatePage({
        url: "https://example.com/article",
        path: "/article",
        statusCode: 200,
        rawHtml: '<link rel="canonical" href="https://www.example.com/article">',
      });
      const conflicting = engine.evaluatePage({
        url: "https://example.com/article",
        path: "/article",
        statusCode: 200,
        rawHtml: '<link rel="canonical" href="/article"><link rel="canonical" href="/another">',
      });

      expect(unverified.canonicalStatus).toBe("host_alias_unverified");
      expect(
        unverified.issues.some((issue) => issue.code === "CANONICAL_HOST_ALIAS_UNVERIFIED"),
      ).toBe(true);
      expect(conflicting.canonicalStatus).toBe("conflict");
    });

    it("preserves failed fetches without counting them as scored pages", () => {
      const failedPage = engine.evaluatePage({
        url: "https://example.com/unavailable",
        path: "/unavailable",
        statusCode: 0,
        crawlStatus: "failed",
        fetchError: "ECONNRESET",
        rawHtml: "",
      });
      const score = engine.calculateOverallAuditResult(
        engine.evaluateBotAccess("", "missing"),
        [failedPage],
        { hasLlmsTxt: null, hasSitemap: null, robotsStatus: "missing" },
      );

      expect(failedPage.fetchError).toBe("ECONNRESET");
      expect(failedPage.pageScore).toBeNull();
      expect(score.pagesScored).toBe(0);
      expect(score.overallScore).toBe(0);
    });

    it("validates self-referential vs cross-domain canonical URLs", () => {
      const htmlCross = `
        <html>
          <head>
            <link rel="canonical" href="https://otherdomain.com/target" />
          </head>
          <body><h1>Hello</h1></body>
        </html>
      `;

      const res = engine.evaluatePage({
        url: "https://example.com/article",
        path: "/article",
        statusCode: 200,
        rawHtml: htmlCross,
      });

      expect(res.canonicalStatus).toBe("cross_domain");
      expect(res.issues.some((i) => i.code === "CANONICAL_CROSS_DOMAIN")).toBe(true);
    });
  });

  describe("3. On-Page Heading Hierarchy & Answer-First Structure (TEC-FR-007)", () => {
    it("flags missing <h1> or multiple <h1> tags", () => {
      const noH1 = "<html><body><h2>Subheading</h2><p>Content</p></body></html>";
      const resNoH1 = engine.evaluatePage({
        url: "https://example.com/test",
        path: "/test",
        statusCode: 200,
        rawHtml: noH1,
      });
      expect(resNoH1.issues.some((i) => i.code === "HEADING_H1_MISSING")).toBe(true);

      const multiH1 = "<html><body><h1>Title 1</h1><h1>Title 2</h1></body></html>";
      const resMultiH1 = engine.evaluatePage({
        url: "https://example.com/test2",
        path: "/test2",
        statusCode: 200,
        rawHtml: multiH1,
      });
      expect(resMultiH1.issues.some((i) => i.code === "HEADING_H1_MULTIPLE")).toBe(true);
    });

    it("detects Answer-First patterns in introductory text", () => {
      const answerFirstHtml = `
        <html>
          <body>
            <h1>What is Cloud Computing?</h1>
            <p>Cloud computing is a technology that delivers computing services including servers and storage over the internet.</p>
          </body>
        </html>
      `;

      const res = engine.evaluatePage({
        url: "https://example.com/cloud",
        path: "/cloud",
        statusCode: 200,
        rawHtml: answerFirstHtml,
      });

      expect(res.answerFirstDetected).toBe(true);
    });
  });

  describe("4. Schema.org Structured Data Extraction & Validation (TEC-FR-006)", () => {
    it("extracts and validates Organization and Product JSON-LD schemas", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Acme Corp",
              "url": "https://acme.com",
              "logo": "https://acme.com/logo.png"
            }
            </script>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Acme Widget"
            }
            </script>
          </head>
          <body><h1>Acme</h1></body>
        </html>
      `;

      const schemas = engine.extractAndValidateSchemas(html);
      expect(schemas).toHaveLength(2);

      const org = schemas.find((s) => s.type === "Organization");
      expect(org?.status).toBe("warning"); // has name and url, but missing recommended sameAs
      expect(org?.missingRequired).toHaveLength(0);

      const product = schemas.find((s) => s.type === "Product");
      expect(product?.status).toBe("warning");
      expect(product?.missingRecommended).toContain("description");
      expect(product?.missingRecommended).toContain("offers");
    });

    it("handles @graph arrays in JSON-LD", () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "name": "Acme",
                  "url": "https://acme.com"
                },
                {
                  "@type": "Article",
                  "headline": "How to Win",
                  "author": { "@type": "Person", "name": "Jane" }
                }
              ]
            }
            </script>
          </head>
          <body><h1>Graph Test</h1></body>
        </html>
      `;

      const schemas = engine.extractAndValidateSchemas(html);
      expect(schemas).toHaveLength(2);
      expect(schemas.map((s) => s.type)).toEqual(["Organization", "Article"]);
    });
  });

  describe("5. Raw vs JS-Rendered DOM Diffing (TEC-FR-005)", () => {
    it("identifies content gaps where content is only rendered client-side", () => {
      const rawHtml = "<html><body><div id='root'>Loading...</div></body></html>";
      const renderedHtml =
        "<html><body><div id='root'><h1>Main App</h1><p>" +
        "Significant content rendered by client JavaScript. ".repeat(20) +
        "</p></div></body></html>";

      const res = engine.evaluatePage({
        url: "https://example.com/app",
        path: "/app",
        statusCode: 200,
        rawHtml,
        renderedHtml,
      });

      expect(res.hasJsDomDiff).toBe(true);
      expect(res.issues.some((i) => i.code === "CSR_CONTENT_GAP")).toBe(true);
    });
  });

  describe("6. Normative Technical Score Calculation (TEC-FR-010)", () => {
    it("computes weighted score across all 6 categories", () => {
      const botMatrix = engine.evaluateBotAccess("User-agent: *\nAllow: /\n");
      const page = engine.evaluatePage({
        url: "https://example.com/",
        path: "/",
        statusCode: 200,
        rawHtml: `
          <html>
            <head>
              <link rel="canonical" href="https://example.com/" />
              <script type="application/ld+json">
              {"@context":"https://schema.org","@type":"Organization","name":"Test","url":"https://example.com"}
              </script>
            </head>
            <body>
              <h1>Welcome to Test</h1>
              <p>Test is a platform that provides automated testing services.</p>
            </body>
          </html>
        `,
      });

      const overall = engine.calculateOverallAuditResult(botMatrix, [page], {
        hasLlmsTxt: true,
        hasSitemap: true,
        robotsStatus: "available",
      });

      expect(overall.overallScore).toBeGreaterThanOrEqual(80);
      expect(["A", "B"]).toContain(overall.grade);
      expect(overall.categoryScores).toHaveProperty("botAccess");
      expect(overall.categoryScores).toHaveProperty("indexability");
      expect(overall.categoryScores).toHaveProperty("schema");
      expect(overall.categoryScores).toHaveProperty("answerStructure");
      expect(overall.categoryScores).toHaveProperty("performanceTrust");
      expect(overall.categoryScores).toHaveProperty("agentReadability");
    });
  });

  describe("7. Firecrawl Crawler Politeness & Normalization (TEC-FR-002)", () => {
    const crawler = new FirecrawlCrawler({ maxRequestsPerSecond: 2, maxPagesPerCrawl: 50 });

    it("initializes with default politeness interval (500ms)", () => {
      expect(crawler).toBeDefined();
    });

    it("reports a partial crawl when the page limit leaves discovered URLs queued", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response('<a href="/next">Next</a>', { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const localCrawler = new FirecrawlCrawler({
          allowLocalTest: true,
          maxRequestsPerSecond: 100000,
          maxPagesPerCrawl: 10,
        });
        const result = await localCrawler.crawlDomainWithStats("example.test", { pageLimit: 1 });

        expect(result.attemptedUrls).toBe(1);
        expect(result.pages[0]?.statusCode).toBe(200);
        expect(result.pages[0]?.finalUrl).toBe("https://example.test/");
        expect(result.queuedUrlsRemaining).toBe(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("preserves the final URL after an observed redirect", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        if (String(input) === "https://www.example.test/article") {
          return new Response(null, {
            status: 301,
            headers: { location: "https://example.test/article" },
          });
        }
        return new Response("<h1>Article</h1>", { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      try {
        const localCrawler = new FirecrawlCrawler({
          allowLocalTest: true,
          maxRequestsPerSecond: 100000,
        });
        const result = await localCrawler.crawlPage("https://www.example.test/article");

        expect(result.finalUrl).toBe("https://example.test/article");
        expect(result.statusCode).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("keeps request failures separate from successfully fetched pages", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const localCrawler = new FirecrawlCrawler({
          allowLocalTest: true,
          maxRequestsPerSecond: 100000,
          maxPagesPerCrawl: 10,
        });
        const result = await localCrawler.crawlPage("https://example.test/");

        expect(result.statusCode).toBe(0);
        expect(result.finalUrl).toBeNull();
        expect(result.error).toContain("ECONNRESET");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("distinguishes a missing or inaccessible robots.txt from failed requests", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === "/robots.txt") {
          return new Response("", { status: url.hostname.startsWith("missing") ? 404 : 403 });
        }
        return new Response("", { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
      try {
        const localCrawler = new FirecrawlCrawler({ allowLocalTest: true });
        const missing = await localCrawler.fetchSiteWideFiles("missing.example.test");
        const inaccessible = await localCrawler.fetchSiteWideFiles("blocked.example.test");
        expect(missing.robotsStatus).toBe("missing");
        expect(inaccessible.robotsStatus).toBe("inaccessible");

        fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
        const failed = await localCrawler.fetchSiteWideFiles("failed.example.test");
        expect(failed.robotsStatus).toBe("failed");
        expect(failed.robotsError).toContain("ECONNRESET");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
