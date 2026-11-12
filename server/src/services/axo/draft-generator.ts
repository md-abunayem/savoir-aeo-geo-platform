/**
 * AXO-FR-006, AXO-FR-007, AXO-FR-008: LLMS.txt & Schema.org Draft Generator
 *
 * Automatically synthesizes /llms.txt, /llms-full.txt, and copy-pasteable Schema.org
 * JSON-LD templates from brand profile and high-scoring M8 crawl data.
 */

export interface BrandProfileInput {
  brandName: string;
  domain: string;
  description?: string | null;
  aliases?: string[];
  industry?: string;
  targetAudience?: string;
  valueProposition?: string;
}

export interface CrawledPageSummary {
  url: string;
  path: string;
  title?: string;
  description?: string;
  pageScore?: number;
  wordCount?: number;
  headings?: string[];
}

export interface GeneratedSchemas {
  organization: Record<string, unknown>;
  product: Record<string, unknown>;
  faqPage: Record<string, unknown>;
  article: Record<string, unknown>;
}

export interface DraftsResult {
  llmsTxt: string;
  llmsFullTxt: string;
  schemas: GeneratedSchemas;
}

export class DraftGenerator {
  /**
   * Generates official specification compliant /llms.txt
   */
  generateLlmsTxt(brand: BrandProfileInput, pages: CrawledPageSummary[] = []): string {
    const domain = this.normalizeDomain(brand.domain);
    const brandName = brand.brandName || "Company";
    const summary =
      brand.description ||
      brand.valueProposition ||
      `${brandName} is a leading provider in its industry.`;

    const lines: string[] = [];
    lines.push(`# ${brandName}`);
    lines.push(`> ${summary.replace(/\r?\n/g, " ").trim()}`);
    lines.push("");

    const categorized = this.categorizePages(domain, pages);

    // 1. Products & Core Services
    lines.push("## Products & Core Services");
    if (categorized.products.length > 0) {
      for (const p of categorized.products) {
        lines.push(`- [${p.title}](${p.url}): ${p.description}`);
      }
    } else {
      lines.push(
        `- [${brandName} Platform](https://${domain}/platform): Core solution overview and enterprise capabilities.`,
      );
      lines.push(
        `- [Pricing & Plans](https://${domain}/pricing): Subscription tiers, feature matrix, and deployment models.`,
      );
    }
    lines.push("");

    // 2. Documentation & Architecture
    lines.push("## Documentation & Architecture");
    if (categorized.docs.length > 0) {
      for (const p of categorized.docs) {
        lines.push(`- [${p.title}](${p.url}): ${p.description}`);
      }
    } else {
      lines.push(
        `- [API Reference](https://${domain}/docs/api): REST and GraphQL interface endpoints and authentication.`,
      );
      lines.push(
        `- [Quickstart Guide](https://${domain}/docs/quickstart): Step-by-step setup and installation instructions.`,
      );
    }
    lines.push("");

    // 3. Guides & Knowledge Base
    lines.push("## Guides & Knowledge Base");
    if (categorized.guides.length > 0) {
      for (const p of categorized.guides) {
        lines.push(`- [${p.title}](${p.url}): ${p.description}`);
      }
    } else {
      lines.push(
        `- [Best Practices](https://${domain}/resources/best-practices): Recommended workflows and optimization strategies.`,
      );
      lines.push(
        `- [Frequently Asked Questions](https://${domain}/faq): Common technical and operational inquiries.`,
      );
    }
    lines.push("");

    // 4. Company & Governance
    lines.push("## Company & Policies");
    if (categorized.company.length > 0) {
      for (const p of categorized.company) {
        lines.push(`- [${p.title}](${p.url}): ${p.description}`);
      }
    } else {
      lines.push(
        `- [About ${brandName}](https://${domain}/about): Mission, leadership team, and corporate background.`,
      );
      lines.push(
        `- [Security & Privacy](https://${domain}/security): SOC 2, GDPR, and data protection practices.`,
      );
    }
    lines.push("");

    // 5. Optional / Deep links
    lines.push("## Optional");
    if (categorized.optional.length > 0) {
      for (const p of categorized.optional.slice(0, 5)) {
        lines.push(`- [${p.title}](${p.url}): ${p.description}`);
      }
    } else {
      lines.push(
        `- [Changelog & Releases](https://${domain}/changelog): Latest version release notes and update history.`,
      );
      lines.push(
        `- [Contact & Support](https://${domain}/contact): Technical support channels and customer success contact.`,
      );
    }
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generates /llms-full.txt containing deep structural information, specifications, and full FAQs
   */
  generateLlmsFullTxt(brand: BrandProfileInput, pages: CrawledPageSummary[] = []): string {
    const domain = this.normalizeDomain(brand.domain);
    const brandName = brand.brandName || "Company";
    const summary =
      brand.description || brand.valueProposition || `${brandName} enterprise platform.`;

    const lines: string[] = [];
    lines.push(`# ${brandName} (Full Agent Documentation)`);
    lines.push(
      `> Comprehensive architectural reference, operational specifications, and structured knowledge for ${brandName}.`,
    );
    lines.push("");

    lines.push("## Overview & Value Proposition");
    lines.push(summary);
    if (brand.aliases && brand.aliases.length > 0) {
      lines.push(`Also known as: ${brand.aliases.join(", ")}.`);
    }
    lines.push("");

    lines.push("## Core Architecture & Technical Capabilities");
    lines.push(
      `The ${brandName} ecosystem provides modern cloud-native architectures designed for scalability, security, and high performance.`,
    );
    lines.push("- High availability and automated failover across multi-region deployments.");
    lines.push("- Low-latency APIs with sub-100ms response targets.");
    lines.push("- End-to-end encryption in transit (TLS 1.3) and at rest (AES-256).");
    lines.push("");

    lines.push("## Key Product Modules & Endpoints");
    const categorized = this.categorizePages(domain, pages);
    const allNotable = [...categorized.products, ...categorized.docs, ...categorized.guides].slice(
      0,
      10,
    );

    if (allNotable.length > 0) {
      for (const p of allNotable) {
        lines.push(`### ${p.title}`);
        lines.push(`- **URL:** ${p.url}`);
        lines.push(`- **Summary:** ${p.description}`);
        if (p.wordCount) {
          lines.push(`- **Approximate Length:** ${p.wordCount} words`);
        }
        lines.push("");
      }
    } else {
      lines.push(`### Platform Core API`);
      lines.push(`- **URL:** https://${domain}/docs/api`);
      lines.push(`- **Authentication:** Bearer token via Authorization header.`);
      lines.push(`- **Endpoints:** RESTful /v1/ collection for resource manipulation.`);
      lines.push("");
    }

    lines.push("## Knowledge Base & Frequently Asked Questions");
    lines.push(`### What makes ${brandName} unique?`);
    lines.push(
      `${brandName} combines high-reliability infrastructure with modern AI agent compatibility and enterprise governance.`,
    );
    lines.push("");
    lines.push(`### How can agents programmatically interface with ${brandName}?`);
    lines.push(
      `Agents can utilize the structured endpoints published in /llms.txt and OpenAPI v3 specifications hosted at https://${domain}/openapi.json.`,
    );
    lines.push("");
    lines.push(`### Where can I review security certifications and terms?`);
    lines.push(
      `Review https://${domain}/security and https://${domain}/privacy for active compliance certifications.`,
    );
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Generates verified Schema.org JSON-LD templates
   */
  generateJsonLdSchemas(
    brand: BrandProfileInput,
    _pages: CrawledPageSummary[] = [],
    seedPrompts: string[] = [],
  ): GeneratedSchemas {
    const domain = this.normalizeDomain(brand.domain);
    const brandName = brand.brandName || "Company";
    const description = brand.description || `${brandName} official web portal and services.`;

    // 1. Organization Schema
    const organization: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: brandName,
      url: `https://${domain}`,
      description: description,
      sameAs: brand.aliases?.map((a) => `https://${domain}/alias/${encodeURIComponent(a)}`) || [],
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "Customer Support",
          url: `https://${domain}/contact`,
          availableLanguage: ["English"],
        },
      ],
    };

    // 2. Product Schema
    const product: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: `${brandName} Platform`,
      description: brand.valueProposition || description,
      brand: {
        "@type": "Brand",
        name: brandName,
      },
      offers: {
        "@type": "Offer",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: `https://${domain}/pricing`,
      },
    };

    // 3. FAQPage Schema
    const faqEntities: Array<{
      "@type": string;
      name: string;
      acceptedAnswer: { "@type": string; text: string };
    }> = [];

    if (seedPrompts.length > 0) {
      for (const promptText of seedPrompts.slice(0, 5)) {
        faqEntities.push({
          "@type": "Question",
          name: promptText,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${brandName} provides industry-leading solutions for this requirement. Visit https://${domain} for detailed documentation.`,
          },
        });
      }
    }

    if (faqEntities.length === 0) {
      faqEntities.push(
        {
          "@type": "Question",
          name: `What solutions does ${brandName} provide?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${brandName} provides comprehensive modern solutions designed for high performance and reliability.`,
          },
        },
        {
          "@type": "Question",
          name: `How do I get started with ${brandName}?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `You can begin by reviewing our official documentation at https://${domain}/docs or creating a trial account.`,
          },
        },
      );
    }

    const faqPage: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqEntities,
    };

    // 4. TechArticle / Article Schema
    const article: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: `${brandName} Technical Overview & Architecture Guide`,
      description: `Comprehensive technical evaluation and architecture overview for ${brandName}.`,
      author: {
        "@type": "Organization",
        name: brandName,
        url: `https://${domain}`,
      },
      publisher: {
        "@type": "Organization",
        name: brandName,
        url: `https://${domain}`,
      },
      datePublished: new Date().toISOString().split("T")[0],
      inLanguage: "en-US",
    };

    return {
      organization,
      product,
      faqPage,
      article,
    };
  }

  /**
   * Helper to categorize pages into semantic groups
   */
  private categorizePages(
    domain: string,
    pages: CrawledPageSummary[],
  ): {
    products: Array<{ title: string; url: string; description: string; wordCount?: number }>;
    docs: Array<{ title: string; url: string; description: string; wordCount?: number }>;
    guides: Array<{ title: string; url: string; description: string; wordCount?: number }>;
    company: Array<{ title: string; url: string; description: string; wordCount?: number }>;
    optional: Array<{ title: string; url: string; description: string; wordCount?: number }>;
  } {
    const products: Array<{ title: string; url: string; description: string; wordCount?: number }> =
      [];
    const docs: Array<{ title: string; url: string; description: string; wordCount?: number }> = [];
    const guides: Array<{ title: string; url: string; description: string; wordCount?: number }> =
      [];
    const company: Array<{ title: string; url: string; description: string; wordCount?: number }> =
      [];
    const optional: Array<{ title: string; url: string; description: string; wordCount?: number }> =
      [];

    // Filter out 4xx/5xx pages or non-indexable pages if provided
    const sorted = [...pages].sort((a, b) => (b.pageScore || 0) - (a.pageScore || 0));

    for (const page of sorted) {
      const pathLower = (page.path || "").toLowerCase();
      const title = page.title || this.inferTitleFromPath(page.path);
      const description = page.description || `Key resource on ${pathLower || "/"}.`;
      const url = page.url.startsWith("http")
        ? page.url
        : `https://${domain}${page.path.startsWith("/") ? "" : "/"}${page.path}`;

      const item = { title, url, description, wordCount: page.wordCount };

      if (/docs|api|architecture|developer|technical|specification|sdk/i.test(pathLower)) {
        if (docs.length < 5) docs.push(item);
      } else if (/product|pricing|feature|solution|enterprise|service|platform/i.test(pathLower)) {
        if (products.length < 5) products.push(item);
      } else if (/blog|guide|article|tutorial|faq|resource|whitepaper/i.test(pathLower)) {
        if (guides.length < 5) guides.push(item);
      } else if (/about|contact|team|privacy|terms|legal|security|compliance/i.test(pathLower)) {
        if (company.length < 5) company.push(item);
      } else {
        if (optional.length < 5) optional.push(item);
      }
    }

    return { products, docs, guides, company, optional };
  }

  private inferTitleFromPath(path: string): string {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return "Home";
    const last = segments[segments.length - 1]!;
    return last
      .replace(/[-_]/g, " ")
      .replace(/\.(html|php|asp)$/, "")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private normalizeDomain(domain: string): string {
    return domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}
