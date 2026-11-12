/**
 * CNT-FR-003, CNT-FR-004: AEO Content Scorer & Competitor Page Comparison Engine
 *
 * Computes a page-level AEO Content Score (0-100, Modeled) and compares
 * owned pages against top cited competitor pages for the same prompts.
 */

export interface PageContentInput {
  url: string;
  path: string;
  title?: string | null;
  metaDescription?: string | null;
  rawText?: string | null;
  headings?: { h1: number; h2: number; h3: number; h4: number } | string[];
  schemasDetected?: string[] | Array<{ type: string }>;
  hasAnswerFirst?: boolean;
  hasFaqBlocks?: boolean;
  wordCount?: number;
  outboundLinksCount?: number;
  lastModified?: string | Date | null;
  hasAuthorMetadata?: boolean;
}

export interface AeoContentScoreBreakdown {
  contentScore: number; // 0 - 100
  label: "Modeled";
  answerFirstScore: number; // 0 - 25
  entityClarityScore: number; // 0 - 20
  specificityScore: number; // 0 - 15
  citationsScore: number; // 0 - 15
  structureScore: number; // 0 - 10
  schemaScore: number; // 0 - 10
  credibilityScore: number; // 0 - 5
  strengths: string[];
  deficiencies: string[];
  recommendations: string[];
}

export interface CompetitorPageComparison {
  ownedUrl: string;
  competitorUrl: string;
  ownedScore: number;
  competitorScore: number;
  wordCountDelta: number;
  missingEntities: string[];
  missingQuestions: string[];
  schemaGaps: string[];
  structuralDifferences: string[];
  actionableSummary: string;
}

export class ContentScorer {
  /**
   * Computes page-level AEO Content Score (CNT-FR-003)
   */
  scorePage(input: PageContentInput): AeoContentScoreBreakdown {
    const text = input.rawText || `${input.title || ""} ${input.metaDescription || ""}`;
    const _wordCount = input.wordCount || text.split(/\s+/).filter(Boolean).length;
    const strengths: string[] = [];
    const deficiencies: string[] = [];
    const recommendations: string[] = [];

    // 1. Answer-First Structure (25 points)
    let answerFirstScore: number;
    if (input.hasAnswerFirst) {
      answerFirstScore = 25;
      strengths.push("Direct answer identified in introductory section.");
    } else {
      // Check heuristics in text
      const lowerText = text.toLowerCase();
      const hasDefinitionOrSummary =
        lowerText.includes(" is a ") ||
        lowerText.includes(" are ") ||
        lowerText.includes("in summary") ||
        lowerText.includes("key takeaways") ||
        lowerText.includes("overview");

      if (hasDefinitionOrSummary) {
        answerFirstScore = 18;
        strengths.push("Provides clear introductory definitions.");
      } else {
        answerFirstScore = 8;
        deficiencies.push("Lacks an upfront direct answer or executive summary.");
        recommendations.push(
          "Lead with a 40-60 word definitive answer paragraph before expanding.",
        );
      }
    }

    // 2. Entity Clarity (20 points)
    let entityClarityScore: number;
    const capitalizedWords = text.match(/\b[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*\b/g) || [];
    const uniqueEntities = new Set(capitalizedWords);

    if (uniqueEntities.size >= 15) {
      entityClarityScore = 20;
      strengths.push(`Rich entity coverage (${uniqueEntities.size} distinct entities/concepts).`);
    } else if (uniqueEntities.size >= 8) {
      entityClarityScore = 15;
    } else {
      entityClarityScore = 8;
      deficiencies.push("Sparse entity and concept density.");
      recommendations.push(
        "Explicitly reference industry terms, brands, standards, and specifications.",
      );
    }

    // 3. Specificity & Statistics (15 points)
    let specificityScore: number;
    const numbersAndStats =
      text.match(/\b\d+(?:\.\d+)?%|\$\d+(?:,\d+)*(?:\.\d+)?|\b\d{2,}\b/g) || [];

    if (numbersAndStats.length >= 8) {
      specificityScore = 15;
      strengths.push("High quantitative precision with concrete metrics and benchmarks.");
    } else if (numbersAndStats.length >= 3) {
      specificityScore = 10;
    } else {
      specificityScore = 4;
      deficiencies.push("Lacks concrete numbers, benchmarks, or quantitative proof points.");
      recommendations.push(
        "Incorporate specific statistical proof points, percentages, and metrics.",
      );
    }

    // 4. Source Citations & External Attribution (15 points)
    let citationsScore: number;
    const outboundCount = input.outboundLinksCount || 0;
    const hasSourceMentions = /according to|source:|study by|research from|published in/i.test(
      text,
    );

    if (outboundCount >= 3 || hasSourceMentions) {
      citationsScore = 15;
      strengths.push("Grounds claims with external citations and source references.");
    } else if (outboundCount >= 1) {
      citationsScore = 10;
    } else {
      citationsScore = 3;
      deficiencies.push("No external reference citations or authoritative groundings detected.");
      recommendations.push(
        "Add 2-3 links to recognized standards, documentation, or research papers.",
      );
    }

    // 5. Structure for Extraction (10 points)
    let structureScore: number;
    const hasLists = /[-*]\s+|\d+\.\s+/m.test(text);
    const hasFaq = input.hasFaqBlocks || /faq|frequently asked/i.test(text);

    let headingCount = 0;
    if (Array.isArray(input.headings)) {
      headingCount = input.headings.length;
    } else if (input.headings && typeof input.headings === "object") {
      headingCount = (input.headings.h2 || 0) + (input.headings.h3 || 0);
    }

    if (headingCount >= 3 && hasLists) {
      structureScore = 10;
      strengths.push("Well-structured with hierarchical headings and list extraction patterns.");
    } else if (headingCount >= 2 || hasLists || hasFaq) {
      structureScore = 7;
    } else {
      structureScore = 3;
      deficiencies.push("Dense text wall lacking lists or hierarchical subheadings.");
      recommendations.push(
        "Break content into H2/H3 subsections and bulleted lists for parser extraction.",
      );
    }

    // 6. Schema.org Presence (10 points)
    let schemaScore: number;
    const rawSchemas = input.schemasDetected || [];
    const schemaTypes = rawSchemas.map((s) => (typeof s === "string" ? s : s.type));

    if (schemaTypes.length >= 2 || schemaTypes.some((t) => /faqpage|article|product/i.test(t))) {
      schemaScore = 10;
      strengths.push(`Structured data verified (${schemaTypes.join(", ")}).`);
    } else if (schemaTypes.length === 1) {
      schemaScore = 6;
    } else {
      schemaScore = 0;
      deficiencies.push("Missing Schema.org structured data.");
      recommendations.push("Add JSON-LD markup (e.g. Article, FAQPage, or Product).");
    }

    // 7. Credibility & Freshness (5 points)
    let credibilityScore = 0;
    if (input.hasAuthorMetadata) credibilityScore += 3;
    if (input.lastModified) {
      const daysOld = (Date.now() - new Date(input.lastModified).getTime()) / (1000 * 3600 * 24);
      if (daysOld < 90) credibilityScore += 2;
      else if (daysOld < 180) credibilityScore += 1;
    } else {
      credibilityScore += 1;
    }
    credibilityScore = Math.min(5, credibilityScore);

    const contentScore = Math.round(
      answerFirstScore +
        entityClarityScore +
        specificityScore +
        citationsScore +
        structureScore +
        schemaScore +
        credibilityScore,
    );

    return {
      contentScore,
      label: "Modeled",
      answerFirstScore,
      entityClarityScore,
      specificityScore,
      citationsScore,
      structureScore,
      schemaScore,
      credibilityScore,
      strengths,
      deficiencies,
      recommendations,
    };
  }

  /**
   * Compares an owned page against a top cited competitor page (CNT-FR-004)
   */
  compareAgainstCitedPage(
    owned: PageContentInput,
    competitor: PageContentInput,
    topicPrompts: string[] = [],
  ): CompetitorPageComparison {
    const ownedBreakdown = this.scorePage(owned);
    const competitorBreakdown = this.scorePage(competitor);

    const ownedWords = owned.wordCount || 500;
    const compWords = competitor.wordCount || 1000;
    const wordCountDelta = ownedWords - compWords;

    // Entity comparison
    const ownedEntities = new Set(
      (owned.rawText || `${owned.title || ""} ${owned.metaDescription || ""}`).match(
        /\b[A-Z][a-z0-9]+\b/g,
      ) || [],
    );
    const compEntities = new Set(
      (competitor.rawText || `${competitor.title || ""} ${competitor.metaDescription || ""}`).match(
        /\b[A-Z][a-z0-9]+\b/g,
      ) || [],
    );

    const missingEntities: string[] = [];
    for (const ent of compEntities) {
      if (!ownedEntities.has(ent) && ent.length > 3) {
        missingEntities.push(ent);
        if (missingEntities.length >= 8) break;
      }
    }

    // Question / topic comparison
    const missingQuestions: string[] = [];
    for (const prompt of topicPrompts) {
      const promptLower = prompt.toLowerCase();
      const ownedLower = (owned.rawText || owned.title || "").toLowerCase();
      if (!ownedLower.includes(promptLower.slice(0, 20))) {
        missingQuestions.push(prompt);
      }
    }

    // Schema gaps
    const ownedSchemas = new Set(
      (owned.schemasDetected || []).map((s) => (typeof s === "string" ? s : s.type).toLowerCase()),
    );
    const compSchemas = (competitor.schemasDetected || []).map((s) =>
      (typeof s === "string" ? s : s.type).toLowerCase(),
    );
    const schemaGaps = compSchemas.filter((s) => !ownedSchemas.has(s));

    // Structural differences
    const structuralDifferences: string[] = [];
    if (wordCountDelta < -300) {
      structuralDifferences.push(
        `Competitor provides more comprehensive coverage (${compWords} vs ${ownedWords} words).`,
      );
    }
    if (competitor.hasFaqBlocks && !owned.hasFaqBlocks) {
      structuralDifferences.push(
        "Competitor features an FAQ accordion block which AI models cite directly.",
      );
    }
    if (competitor.hasAnswerFirst && !owned.hasAnswerFirst) {
      structuralDifferences.push(
        "Competitor positions a direct answer summary in the first paragraph.",
      );
    }

    const actionableSummary = `To match or outperform ${competitor.url}, expand content depth by approximately ${Math.abs(
      Math.min(0, wordCountDelta),
    )} words, integrate missing concepts (${missingEntities.slice(0, 4).join(", ")}), and adopt an answer-first FAQ section.`;

    return {
      ownedUrl: owned.url,
      competitorUrl: competitor.url,
      ownedScore: ownedBreakdown.contentScore,
      competitorScore: competitorBreakdown.contentScore,
      wordCountDelta,
      missingEntities,
      missingQuestions: missingQuestions.slice(0, 5),
      schemaGaps,
      structuralDifferences,
      actionableSummary,
    };
  }
}
