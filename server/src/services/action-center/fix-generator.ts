/**
 * Fix Guidance Generator (M10 / ACT-FR-005)
 * Generates copy-ready code artifacts and step-by-step remediation snippets.
 * Strictly labeled Estimated; Savoir never auto-publishes or writes directly to customer sites.
 */

export interface FixGuidance {
  type: "jsonld" | "robots" | "llms" | "faq" | "meta" | "guide";
  title: string;
  code?: string;
  instructions: string;
  label: "Estimated";
  disclaimer: string;
}

const MANDATORY_DISCLAIMER =
  "Estimated Guidance: Review and adapt before deploying. Savoir does not auto-publish or write to your site (ACT-FR-005).";

export class FixGenerator {
  /**
   * Generate robots.txt allow directive snippet
   */
  static generateRobotsFix(
    botNames: string[] = ["OAI-SearchBot", "ClaudeBot", "PerplexityBot"],
  ): FixGuidance {
    const lines = botNames.map((bot) => `User-agent: ${bot}\nAllow: /`).join("\n\n");

    return {
      type: "robots",
      title: "Allow AI Search Crawlers in robots.txt",
      code: lines,
      instructions:
        "Paste these directives into your robots.txt file to permit real-time search discovery while keeping training bots controlled if desired.",
      label: "Estimated",
      disclaimer: MANDATORY_DISCLAIMER,
    };
  }

  /**
   * Generate JSON-LD FAQPage structured data
   */
  static generateFaqJsonLd(
    qaPairs: Array<{ question: string; answer: string }> = [
      {
        question: "What is your primary product or service?",
        answer: "Provide a direct, concise 1-2 sentence answer defining your core offering.",
      },
    ],
  ): FixGuidance {
    const schemaObj = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: qaPairs.map((pair) => ({
        "@type": "Question",
        name: pair.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: pair.answer,
        },
      })),
    };

    const code = `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`;

    return {
      type: "jsonld",
      title: "Add FAQPage Structured Data",
      code,
      instructions:
        "Embed this JSON-LD script block in the <head> or at the bottom of the <body> on the relevant page to assist AI engines with direct answer extraction.",
      label: "Estimated",
      disclaimer: MANDATORY_DISCLAIMER,
    };
  }

  /**
   * Generate Organization JSON-LD snippet
   */
  static generateOrganizationJsonLd(domain: string, brandName: string): FixGuidance {
    const schemaObj = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: brandName,
      url: `https://${domain}`,
      sameAs: [
        `https://twitter.com/${brandName.toLowerCase().replace(/\s+/g, "")}`,
        `https://www.linkedin.com/company/${brandName.toLowerCase().replace(/\s+/g, "")}`,
      ],
    };

    const code = `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`;

    return {
      type: "jsonld",
      title: "Add Organization Structured Data",
      code,
      instructions:
        "Include this snippet on your homepage to clearly define brand entity identity, social profiles, and official domain for AI model knowledge graphs.",
      label: "Estimated",
      disclaimer: MANDATORY_DISCLAIMER,
    };
  }

  /**
   * Generate /llms.txt starter draft snippet
   */
  static generateLlmsTxtFix(domain: string, brandName: string): FixGuidance {
    const code = `# ${brandName}
> Concise one-sentence overview of ${brandName}'s core solution and value proposition.

## Key Sections
- [Features](https://${domain}/features): Comprehensive breakdown of platform capabilities
- [Pricing](https://${domain}/pricing): Transparent plans and tiers
- [Docs](https://${domain}/docs): Developer and user documentation

## Optional Resources
- [Full LLM Index](https://${domain}/llms-full.txt): Complete markdown representation
`;

    return {
      type: "llms",
      title: "Create /llms.txt Markdown Index",
      code,
      instructions:
        "Publish this markdown document at the root of your domain (/llms.txt) to provide AI agents with a standardized, curated index of your site.",
      label: "Estimated",
      disclaimer: MANDATORY_DISCLAIMER,
    };
  }

  /**
   * Generate canonical meta tag fix
   */
  static generateCanonicalFix(canonicalUrl: string): FixGuidance {
    const code = `<link rel="canonical" href="${canonicalUrl}" />`;

    return {
      type: "meta",
      title: "Add Self-Referential Canonical Tag",
      code,
      instructions:
        "Place this tag in the <head> of the page to consolidate index signals and avoid dilution from parameterized or duplicate URLs.",
      label: "Estimated",
      disclaimer: MANDATORY_DISCLAIMER,
    };
  }

  /**
   * Generate step-by-step remediation guide
   */
  static generateStepByStepGuide(title: string, steps: string[]): FixGuidance {
    const code = steps.map((s, idx) => `${idx + 1}. ${s}`).join("\n");

    return {
      type: "guide",
      title,
      code,
      instructions: "Execute these remediation steps in your CMS or codebase.",
      label: "Estimated",
      disclaimer: MANDATORY_DISCLAIMER,
    };
  }
}
