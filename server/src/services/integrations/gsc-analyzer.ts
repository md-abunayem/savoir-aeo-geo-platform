/**
 * GSC Query Analyzer & Prompt Suggester (M14 / ITG-FR-001, ITG-F1, M11 / TRF-FR-004)
 * Identifies question queries and evaluates high-demand search opportunities to track as prompts.
 */

export interface GscPromptOpportunity {
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  opportunityScore: number;
  suggestedIntent: "informational" | "comparison" | "commercial";
}

const QUESTION_PATTERNS = [
  /^(how|what|why|where|when|who|which)\b/i,
  /^(can|could|is|are|does|do|will|should)\b/i,
  /\b(best|top|vs|versus|compare|comparison|review|alternative|alternatives)\b/i,
  /\b(tutorial|guide|pricing|cost|worth it)\b/i,
  /\?$/,
];

export class GscAnalyzer {
  /**
   * Determine whether a search query is question-like or comparative
   */
  static isQuestionQuery(query: string): boolean {
    const q = (query || "").trim();
    if (q.length < 5) return false;
    return QUESTION_PATTERNS.some((pattern) => pattern.test(q));
  }

  /**
   * Classify intent of a question query
   */
  static classifyIntent(query: string): "informational" | "comparison" | "commercial" {
    const q = query.toLowerCase();
    if (
      q.includes("vs") ||
      q.includes("versus") ||
      q.includes("compare") ||
      q.includes("alternative")
    ) {
      return "comparison";
    }
    if (
      q.includes("best") ||
      q.includes("top") ||
      q.includes("pricing") ||
      q.includes("cost") ||
      q.includes("review")
    ) {
      return "commercial";
    }
    return "informational";
  }

  /**
   * Rank and filter question queries into prompt candidate suggestions
   */
  static extractPromptOpportunities(
    facts: Array<{
      query: string;
      page: string;
      impressions: number;
      clicks: number;
      ctr: number;
      position: number;
      isQuestionQuery?: boolean;
    }>,
  ): GscPromptOpportunity[] {
    const opportunities: GscPromptOpportunity[] = [];

    for (const f of facts) {
      const isQuestion = f.isQuestionQuery ?? GscAnalyzer.isQuestionQuery(f.query);
      if (!isQuestion) continue;

      // Higher impressions + low CTR + positions 2-15 = prime AEO target
      const posWeight = f.position <= 3 ? 1.0 : f.position <= 10 ? 0.8 : 0.5;
      const opportunityScore = Math.round(f.impressions * (1 - f.ctr) * posWeight);

      opportunities.push({
        query: f.query,
        page: f.page,
        impressions: f.impressions,
        clicks: f.clicks,
        ctr: Number(f.ctr),
        position: Number(f.position),
        opportunityScore,
        suggestedIntent: GscAnalyzer.classifyIntent(f.query),
      });
    }

    return opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);
  }

  /**
   * Mandatory UI disclosure for GSC AI Overview search traffic (TRF-FR-004)
   */
  static getMandatoryDisclosure() {
    return {
      label: "Observed" as const,
      text: "Observed: Google Search Console does not isolate AI Overview / AI Mode search traffic directly (TRF-FR-004).",
      requirement: "TRF-FR-004" as const,
    };
  }
}
