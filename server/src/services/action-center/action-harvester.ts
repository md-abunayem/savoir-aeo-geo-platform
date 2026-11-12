/**
 * Automated Action Harvester & Priority Calculator (M10 / ACT-FR-001, ACT-FR-003, ACT-FR-004)
 * Aggregates findings from M5, M6, M7, M8, M9, and M16 into prioritized, deduplicated action candidates.
 */

import type { Pool } from "pg";
import { FixGenerator, type FixGuidance } from "./fix-generator.js";

export interface HarvestedActionCandidate {
  title: string;
  description: string;
  category: "technical" | "content" | "citation" | "agent_readiness" | "accuracy" | "competitor";
  sourceModule: "M5" | "M6" | "M7" | "M8" | "M9" | "M16";
  sourceId?: string;
  dedupKey: string;
  impact: number; // 1-10
  confidence: number; // 0.00-1.00
  effort: "S" | "M" | "L";
  priorityScore: number; // 0-100, Modeled
  evidence: Array<{
    url?: string;
    promptId?: string;
    quote?: string;
    source?: string;
    date?: string;
    findingType?: string;
  }>;
  fixGuidance?: FixGuidance;
}

export class ActionHarvester {
  constructor(private readonly pool: Pool) {}

  /**
   * Calculate Modeled Priority Score: round(clamp(0, 100, (Impact * Confidence / EffortWeight) * 10))
   * S = 1.0, M = 1.8, L = 3.0
   */
  static calculatePriorityScore(
    impact: number,
    confidence: number,
    effort: "S" | "M" | "L",
  ): number {
    const effortWeights: Record<"S" | "M" | "L", number> = {
      S: 1.0,
      M: 1.8,
      L: 3.0,
    };
    const weight = effortWeights[effort] || 1.8;
    const raw = ((impact * confidence) / weight) * 10;
    return Math.round(Math.max(0, Math.min(100, raw)));
  }

  /**
   * Harvest findings across all supported intelligence streams for a given project
   */
  async harvest(
    projectId: string,
    tenantId: string,
    domain: string,
    brandName: string,
  ): Promise<HarvestedActionCandidate[]> {
    const candidates: HarvestedActionCandidate[] = [];

    // 1. M8: Technical Audit Issues
    try {
      const techIssues = await this.pool.query(
        `SELECT id, category, severity, title, explanation, remediation, affected_urls
         FROM technical_audit_issues
         WHERE project_id = $1 AND tenant_id = $2
         ORDER BY (CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END)
         LIMIT 20`,
        [projectId, tenantId],
      );

      for (const row of techIssues.rows) {
        const severity = (row.severity || "medium").toLowerCase();
        const impact =
          severity === "critical" ? 10 : severity === "high" ? 8 : severity === "medium" ? 5 : 3;
        const effort: "S" | "M" | "L" =
          row.category === "ai_bot_access" ? "S" : row.category === "schema" ? "S" : "M";
        const confidence = 0.95;
        const priorityScore = ActionHarvester.calculatePriorityScore(impact, confidence, effort);

        let fix: FixGuidance | undefined;
        if (row.category === "ai_bot_access") {
          fix = FixGenerator.generateRobotsFix(["OAI-SearchBot", "ClaudeBot", "PerplexityBot"]);
        } else if (row.category === "schema") {
          fix = FixGenerator.generateOrganizationJsonLd(domain, brandName);
        } else if (row.category === "indexability") {
          const firstUrl =
            Array.isArray(row.affected_urls) && row.affected_urls.length > 0
              ? row.affected_urls[0]
              : `https://${domain}`;
          fix = FixGenerator.generateCanonicalFix(firstUrl);
        } else {
          fix = FixGenerator.generateStepByStepGuide(row.title, [
            row.explanation || "Investigate the affected pages in your site audit.",
            row.remediation || "Implement the recommended fix.",
          ]);
        }

        candidates.push({
          title: `Technical: ${row.title}`,
          description: row.explanation || "Site audit flagged an AEO technical performance issue.",
          category: "technical",
          sourceModule: "M8",
          sourceId: row.id,
          dedupKey: `M8:technical:${row.category}:${row.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
          impact,
          confidence,
          effort,
          priorityScore,
          evidence: (row.affected_urls || []).slice(0, 5).map((url: string) => ({
            url,
            findingType: row.category,
            quote: row.explanation,
          })),
          fixGuidance: fix,
        });
      }
    } catch {
      // Gracefully continue if table is empty or unpopulated
    }

    // 2. M16: Agent Experience Optimization Policies
    try {
      const axoRes = await this.pool.query(
        `SELECT policy_preset, llms_validation, training_bots_disallowed, search_bots_allowed
         FROM agent_policies
         WHERE project_id = $1 AND tenant_id = $2
         LIMIT 1`,
        [projectId, tenantId],
      );

      if (axoRes.rows.length > 0) {
        const pol = axoRes.rows[0];
        const val = pol.llms_validation || {};
        if (val.isValid === false || (val.score !== undefined && val.score < 70)) {
          const impact = 7;
          const confidence = 0.9;
          const effort = "S";
          candidates.push({
            title: "Publish or Optimize /llms.txt for AI Search Agents",
            description: `The current /llms.txt has a validation score of ${val.score ?? 0}/100. Improving it helps LLM search agents ingest your canonical documents.`,
            category: "agent_readiness",
            sourceModule: "M16",
            dedupKey: `M16:agent_readiness:llms_txt_score`,
            impact,
            confidence,
            effort,
            priorityScore: ActionHarvester.calculatePriorityScore(impact, confidence, effort),
            evidence: [
              {
                url: `https://${domain}/llms.txt`,
                quote: val.error || "Missing or incomplete markdown structure",
              },
            ],
            fixGuidance: FixGenerator.generateLlmsTxtFix(domain, brandName),
          });
        }
      }
    } catch {
      // Gracefully continue
    }

    // 3. M9: Content Gaps & Stale Pages
    try {
      const contentGaps = await this.pool.query(
        `SELECT id, prompt_text, cluster_name, brand_vis_score, priority_score, suggested_action, top_cited_competitor_domains
         FROM content_gaps
         WHERE project_id = $1 AND tenant_id = $2 AND status = 'open'
         ORDER BY priority_score DESC
         LIMIT 10`,
        [projectId, tenantId],
      );

      for (const gap of contentGaps.rows) {
        const impact = Math.min(10, Math.max(5, Math.round(Number(gap.priority_score) / 10)));
        const confidence = 0.85;
        const effort: "S" | "M" | "L" = "M";
        candidates.push({
          title: `Create Content: ${gap.cluster_name} for "${gap.prompt_text}"`,
          description: `Low brand visibility (${(Number(gap.brand_vis_score) * 100).toFixed(0)}%) with no direct owned page answer. ${gap.suggested_action}`,
          category: "content",
          sourceModule: "M9",
          sourceId: gap.id,
          dedupKey: `M9:content_gap:${gap.id}`,
          impact,
          confidence,
          effort,
          priorityScore: ActionHarvester.calculatePriorityScore(impact, confidence, effort),
          evidence: [
            {
              quote: gap.suggested_action,
              findingType: "content_gap",
              source: Array.isArray(gap.top_cited_competitor_domains)
                ? gap.top_cited_competitor_domains.join(", ")
                : undefined,
            },
          ],
          fixGuidance: FixGenerator.generateFaqJsonLd([
            {
              question: gap.prompt_text,
              answer: `Provide a direct, factual answer to "${gap.prompt_text}" in the first 100 words of the page.`,
            },
          ]),
        });
      }

      // Stale high-demand content
      const staleItems = await this.pool.query(
        `SELECT id, url, title, content_score, last_modified
         FROM content_items
         WHERE project_id = $1 AND tenant_id = $2 AND is_stale = true
         LIMIT 5`,
        [projectId, tenantId],
      );

      for (const item of staleItems.rows) {
        const impact = 6;
        const confidence = 0.8;
        const effort = "S";
        candidates.push({
          title: `Update Stale Content: ${item.title || item.url}`,
          description: `Page has not been refreshed in >90 days and risks losing answer engine citations to fresher competitors.`,
          category: "content",
          sourceModule: "M9",
          sourceId: item.id,
          dedupKey: `M9:stale_content:${item.id}`,
          impact,
          confidence,
          effort,
          priorityScore: ActionHarvester.calculatePriorityScore(impact, confidence, effort),
          evidence: [{ url: item.url, quote: `Last modified: ${item.last_modified || "unknown"}` }],
          fixGuidance: FixGenerator.generateStepByStepGuide("Refresh Stale Page for AEO", [
            "Update facts, statistics, and year references to the current date.",
            "Verify that answer-first introductory summaries reflect current product capabilities.",
            "Re-crawl or test the updated page in Savoir.",
          ]),
        });
      }
    } catch {
      // Gracefully continue
    }

    // 4. M6: Citation Gaps & Broken URLs
    try {
      const brokenUrls = await this.pool.query(
        `SELECT DISTINCT url, status_code
         FROM brand_citations
         WHERE project_id = $1 AND tenant_id = $2 AND is_broken = true
         LIMIT 5`,
        [projectId, tenantId],
      );

      for (const broken of brokenUrls.rows) {
        const impact = 8;
        const confidence = 0.95;
        const effort = "S";
        candidates.push({
          title: `Fix Broken Cited URL: ${broken.url}`,
          description: `An AI engine referenced this brand URL, but it returned HTTP status ${broken.status_code || "error"}. Fix or redirect to prevent citation loss.`,
          category: "citation",
          sourceModule: "M6",
          dedupKey: `M6:broken_citation:${broken.url}`,
          impact,
          confidence,
          effort,
          priorityScore: ActionHarvester.calculatePriorityScore(impact, confidence, effort),
          evidence: [{ url: broken.url, quote: `HTTP Status ${broken.status_code}` }],
          fixGuidance: FixGenerator.generateStepByStepGuide("Restore Broken Cited Page", [
            `Verify server response for ${broken.url}.`,
            "If the URL was moved, configure a 301 permanent redirect to the new canonical URL.",
            "Ensure the target page serves valid HTML without 404 or 500 errors.",
          ]),
        });
      }
    } catch {
      // Gracefully continue
    }

    // 5. M7: Competitive Visibility Gaps
    try {
      const compGaps = await this.pool.query(
        `SELECT g.id, g.gap_score, c.name as competitor_name, p.body as prompt_text
         FROM competitive_gaps g
         JOIN competitors c ON g.competitor_id = c.id
         JOIN monitoring_prompts p ON g.prompt_id = p.id
         WHERE g.project_id = $1 AND g.tenant_id = $2 AND g.gap_score > 0
         ORDER BY g.gap_score DESC
         LIMIT 5`,
        [projectId, tenantId],
      );

      for (const gap of compGaps.rows) {
        const impact = 7;
        const confidence = 0.85;
        const effort = "M";
        candidates.push({
          title: `Close Competitor Gap vs ${gap.competitor_name} on "${gap.prompt_text}"`,
          description: `${gap.competitor_name} maintains superior visibility (Gap Score: ${Number(gap.gap_score).toFixed(2)}) on this tracked query.`,
          category: "competitor",
          sourceModule: "M7",
          sourceId: gap.id,
          dedupKey: `M7:competitive_gap:${gap.id}`,
          impact,
          confidence,
          effort,
          priorityScore: ActionHarvester.calculatePriorityScore(impact, confidence, effort),
          evidence: [{ quote: `Competitor: ${gap.competitor_name}, Gap: ${gap.gap_score}` }],
          fixGuidance: FixGenerator.generateStepByStepGuide(
            "Competitive Head-to-Head Optimization",
            [
              `Audit ${gap.competitor_name}'s cited domain references for this prompt.`,
              "Publish a clear comparison or solution guide directly answering the prompt.",
              "Ensure entity markup and key differentiators are present on the target page.",
            ],
          ),
        });
      }
    } catch {
      // Gracefully continue
    }

    return candidates;
  }
}
