import { describe, it, expect } from "vitest";
import {
  extractCitations,
  normalizeUrl,
  classifySourceType,
} from "../src/services/answer/citation-extractor.js";

describe("Citation Extractor & Classifier (CIT-FR-001, CIT-FR-002, NFR-QUAL-002)", () => {
  const context = {
    brandDomain: "acme.com",
    brandAliases: ["acme.io", "acme-corp.com"],
    competitorDomains: ["competitor.com", "rival.net"],
  };

  describe("URL Normalization & Canonicalization (CIT-FR-001)", () => {
    it("strips UTM and tracking parameters", () => {
      const url =
        "https://www.example.com/pricing?utm_source=google&utm_medium=cpc&utm_campaign=spring_sale&ref=twitter&gclid=xyz123";
      const normalized = normalizeUrl(url);

      expect(normalized?.normalizedUrl).toBe("https://example.com/pricing");
      expect(normalized?.domain).toBe("example.com");
    });

    it("lowercases domain and standardizes default ports", () => {
      const url = "HTTPS://WWW.EXAMPLE.COM:443/docs/";
      const normalized = normalizeUrl(url);

      expect(normalized?.normalizedUrl).toBe("https://example.com/docs");
      expect(normalized?.domain).toBe("example.com");
    });

    it("strips trailing slash for root paths", () => {
      const url = "https://example.com/";
      const normalized = normalizeUrl(url);

      expect(normalized?.normalizedUrl).toBe("https://example.com");
    });

    it("retains legitimate non-tracking query parameters in alphabetical order", () => {
      const url = "https://example.com/search?q=aeo&page=2&utm_medium=cpc";
      const normalized = normalizeUrl(url);

      expect(normalized?.normalizedUrl).toBe("https://example.com/search?page=2&q=aeo");
    });

    it("returns null for malformed or non-http URLs", () => {
      expect(normalizeUrl("javascript:alert(1)")).toBeNull();
      expect(normalizeUrl("ftp://files.example.com")).toBeNull();
    });
  });

  describe("Source Type Classification (CIT-FR-002)", () => {
    const testCases: { domain: string; expected: string }[] = [
      { domain: "acme.com", expected: "brand" },
      { domain: "blog.acme.com", expected: "brand" },
      { domain: "acme.io", expected: "brand" },
      { domain: "competitor.com", expected: "competitor" },
      { domain: "app.rival.net", expected: "competitor" },
      { domain: "g2.com", expected: "review_comparison" },
      { domain: "trustpilot.com", expected: "review_comparison" },
      { domain: "reddit.com", expected: "forum_ugc" },
      { domain: "stackoverflow.com", expected: "forum_ugc" },
      { domain: "twitter.com", expected: "social" },
      { domain: "x.com", expected: "social" },
      { domain: "linkedin.com", expected: "social" },
      { domain: "wikipedia.org", expected: "encyclopedia" },
      { domain: "investopedia.com", expected: "encyclopedia" },
      { domain: "cdc.gov", expected: "government_education" },
      { domain: "harvard.edu", expected: "government_education" },
      { domain: "amazon.com", expected: "marketplace" },
      { domain: "nytimes.com", expected: "news_media" },
      { domain: "techcrunch.com", expected: "news_media" },
      { domain: "docs.stripe.com", expected: "documentation_blog" },
      { domain: "github.com", expected: "documentation_blog" },
      { domain: "random-personal-site.org", expected: "other" },
    ];

    for (const { domain, expected } of testCases) {
      it(`classifies ${domain} as ${expected}`, () => {
        expect(classifySourceType(domain, context)).toBe(expected);
      });
    }
  });

  describe("Extracting Citations from Answer Text & Provider Payload", () => {
    it("extracts and merges citations from provider payload and markdown links without duplicates", () => {
      const text = `
For a full review, see [G2 Cloud Review](https://www.g2.com/products/acme/reviews?utm_source=bing).
Also check https://techcrunch.com/2026/01/cloud-wars for news coverage.
      `;
      const providerCitations = [
        { url: "https://www.g2.com/products/acme/reviews", title: "G2 Review" },
        { url: "https://acme.com/docs", title: "Acme Documentation" },
      ];

      const citations = extractCitations(text, providerCitations, context);

      expect(citations.length).toBe(3);
      expect(citations[0].normalizedUrl).toBe("https://g2.com/products/acme/reviews");
      expect(citations[0].sourceType).toBe("review_comparison");

      expect(citations[1].normalizedUrl).toBe("https://acme.com/docs");
      expect(citations[1].sourceType).toBe("brand");

      expect(citations[2].domain).toBe("techcrunch.com");
      expect(citations[2].sourceType).toBe("news_media");
    });
  });
});
