import { it, expect, vi, afterEach } from "vitest";
import { FirecrawlCrawler } from "../src/services/technical/firecrawl-crawler.js";
import { AeoRuleEngine } from "../src/services/technical/aeo-rule-engine.js";
afterEach(() => vi.unstubAllGlobals());
it("limits author and date suggestions to article-like content", () => {
  const engine = new AeoRuleEngine();
  const content = "<h1>Our products</h1><p>" + "Useful product details. ".repeat(140) + "</p>";
  const input = { url: "https://example.test/", path: "/", statusCode: 200, rawHtml: content };
  expect(engine.evaluatePage(input).issues.some((i) => i.code === "EEAT_METADATA_MISSING")).toBe(
    false,
  );
  expect(
    engine
      .evaluatePage({
        ...input,
        rawHtml: '<script type="application/ld+json">{"@type":"Article"}</script>' + content,
      })
      .issues.some((i) => i.code === "EEAT_METADATA_MISSING"),
  ).toBe(true);
});
it("uses a verified final URL to avoid fetching the www homepage again", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          html: '<h1>Home</h1><a href="https://www.example.test/">Home</a>',
          rawHtml: "<h1>Home</h1>",
          metadata: { statusCode: 200, url: "https://www.example.test/" },
        },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const crawler = new FirecrawlCrawler({
    firecrawlApiKey: "private-key",
    allowLocalTest: true,
    maxRequestsPerSecond: 100000,
  });
  const result = await crawler.crawlDomainWithStats("example.test");
  expect(result.pages).toHaveLength(1);
  expect(result.pages[0]?.source).toBe("firecrawl");
  expect(result.queuedUrlsRemaining).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("preserves a safe fallback reason on provider rejection", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("secret provider detail", { status: 402 }))
    .mockResolvedValueOnce(new Response("<h1>Home</h1>", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const crawler = new FirecrawlCrawler({
    firecrawlApiKey: "private-key",
    allowLocalTest: true,
    maxRequestsPerSecond: 100000,
  });
  expect(await crawler.crawlPage("https://example.test/")).toMatchObject({
    source: "direct",
    fallbackReason: "FIRECRAWL_HTTP_402",
    statusCode: 200,
  });
});
it("falls back on empty provider content instead of treating it as a successful page", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} })))
    .mockResolvedValueOnce(new Response("<h1>Home</h1>", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const crawler = new FirecrawlCrawler({
    firecrawlApiKey: "private-key",
    allowLocalTest: true,
    maxRequestsPerSecond: 100000,
  });
  expect(await crawler.crawlPage("https://example.test/")).toMatchObject({
    source: "direct",
    fallbackReason: "FIRECRAWL_EMPTY_RESPONSE",
  });
});
