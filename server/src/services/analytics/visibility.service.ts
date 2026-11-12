import type { Pool } from "pg";
import { ApiError } from "../../utils/ApiError.js";
import {
  calculateWilsonInterval,
  evaluateConfidence,
  calculateTwoProportionZTest,
  applyBenjaminiHochberg,
  calculateCompositeScore,
  calculateRollingAverage,
  type ConfidenceTier,
  type GradeBand,
  type AnomalyCandidate,
  type TimeSeriesPoint,
} from "./statistics.js";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role?: string;
}

export interface VisibilityQuery {
  dateFrom?: string;
  dateTo?: string;
  days?: number;
  engine?: string;
  market?: string;
}

export interface MetricValue {
  value: number;
  label: "Observed" | "Modeled" | "Estimated";
  n: number;
  ciLow?: number;
  ciHigh?: number;
  confidenceTier: ConfidenceTier;
  confidenceLabel: string;
  displayable: boolean;
  delta?: number;
  deltaPercent?: number;
}

export interface EngineBreakdown {
  engine: string;
  name: string;
  visibilityRate: number;
  n: number;
  positionScore: number;
  sentimentScore: number;
  citationRate: number;
  compositeScore: number;
  grade: GradeBand;
}

export interface CompetitorVisibility {
  id: string;
  name: string;
  domain?: string | null;
  isDirect?: boolean;
  visibilityRate: number;
  shareOfVoice: number;
  mentionCount: number;
}

export interface PromptVisibilityBreakdown {
  promptId: string;
  text: string;
  priority: number;
  totalRuns: number;
  mentionedRuns: number;
  visibilityRate: number;
  averageRank: number | null;
}

export interface VisibilityOverview {
  project: {
    id: string;
    brandName: string;
    domain: string;
    description?: string | null;
  };
  timeWindow: {
    current: { from: string; to: string; days: number };
    previous: { from: string; to: string; days: number };
  };
  composite: {
    score: number;
    grade: GradeBand;
    label: "Modeled";
    delta?: number;
    deltaPercent?: number;
    fairShare: number;
    sovRatio: number;
  };
  metrics: {
    visibilityRate: MetricValue;
    shareOfVoice: MetricValue;
    positionScore: MetricValue;
    sentimentScore: MetricValue;
    citationRate: MetricValue;
    recommendedRate: MetricValue;
    netSentiment: { value: number; label: "Estimated" };
  };
  sampleSummary: {
    totalValidRuns: number;
    brandMentionedRuns: number;
    runsWithCitations: number;
    brandCitedRuns: number;
    failureRate: number;
    totalRunsAttempted: number;
  };
  competitors: CompetitorVisibility[];
  engines: EngineBreakdown[];
  prompts: PromptVisibilityBreakdown[];
}

export interface TrendDataPoint extends TimeSeriesPoint {
  visibilityRate: number;
  sampleSize: number;
  shareOfVoice: number;
  citationRate: number;
  compositeScore: number;
  grade: GradeBand;
}

export interface TrendResponse {
  points: TrendDataPoint[];
  events: Array<{
    date: string;
    title: string;
    description: string;
    type: "engine_update" | "prompt_change" | "milestone";
  }>;
}

export interface SavedViewInput {
  name: string;
  filters: Record<string, unknown>;
}

export interface MetricGoalInput {
  metricName: string;
  targetValue: number;
  deadline?: string | null;
  status?: string;
}

interface RunRow {
  run_id: string;
  prompt_id: string | null;
  engine: string;
  geo: string;
  language: string;
  status: string;
  run_date: string;
  created_at: Date;
  priority: number | null;
  weight: number | null;
  answer_id: string | null;
  has_citations: boolean;
  has_brand_mention: boolean;
  brand_min_rank: number | null;
  brand_sentiment: number | null;
  has_brand_citation: boolean;
  citations_count: number;
}

interface CompetitorMentionRow {
  competitor_id: string;
  competitor_name: string;
  run_id: string;
  engine: string;
  run_date: string;
}

export class VisibilityService {
  constructor(private readonly pool: Pool) {}

  private async assertProjectAccess(context: TenantContext, projectId: string) {
    const res = await this.pool.query(
      `SELECT id, tenant_id, brand_name, domain, description 
       FROM public.projects 
       WHERE id = $1 AND tenant_id = $2`,
      [projectId, context.tenantId],
    );
    if (!res.rows.length) {
      throw new ApiError(404, "Project not found or access denied", "PROJECT_NOT_FOUND");
    }
    return res.rows[0];
  }

  private resolveDateWindows(query: VisibilityQuery): {
    current: { from: Date; to: Date; fromStr: string; toStr: string; days: number };
    previous: { from: Date; to: Date; fromStr: string; toStr: string; days: number };
  } {
    const now = new Date();
    let days = query.days ?? 7;
    let curEnd: Date;
    let curStart: Date;

    if (query.dateTo) {
      curEnd = new Date(query.dateTo + "T23:59:59.999Z");
    } else {
      curEnd = now;
    }

    if (query.dateFrom) {
      curStart = new Date(query.dateFrom + "T00:00:00.000Z");
      days = Math.max(1, Math.round((curEnd.getTime() - curStart.getTime()) / (86400 * 1000)));
    } else {
      curStart = new Date(curEnd.getTime() - (days - 1) * 86400 * 1000);
      curStart.setUTCHours(0, 0, 0, 0);
    }

    const prevEnd = new Date(curStart.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400 * 1000);
    prevStart.setUTCHours(0, 0, 0, 0);

    return {
      current: {
        from: curStart,
        to: curEnd,
        fromStr: curStart.toISOString().slice(0, 10),
        toStr: curEnd.toISOString().slice(0, 10),
        days,
      },
      previous: {
        from: prevStart,
        to: prevEnd,
        fromStr: prevStart.toISOString().slice(0, 10),
        toStr: prevEnd.toISOString().slice(0, 10),
        days,
      },
    };
  }

  private async fetchRunsForWindow(
    context: TenantContext,
    projectId: string,
    start: Date,
    end: Date,
    engineFilter?: string,
    marketFilter?: string,
  ): Promise<{
    runs: RunRow[];
    competitorMentions: CompetitorMentionRow[];
    totalAttempted: number;
    failedCount: number;
  }> {
    // 1. Fetch all attempted runs count to calculate failure rate (NFR / SRS Section 9.2)
    const countConditions: string[] = [
      "r.project_id = $1",
      "r.tenant_id = $2",
      "r.created_at >= $3",
      "r.created_at <= $4",
    ];
    const countParams: unknown[] = [projectId, context.tenantId, start, end];

    if (engineFilter && engineFilter !== "all") {
      countParams.push(engineFilter);
      countConditions.push(`coalesce(r.request->>'engine', '') = $${countParams.length}`);
    }
    if (marketFilter && marketFilter !== "all") {
      countParams.push(marketFilter);
      countConditions.push(`coalesce(r.request->>'geo', '') = $${countParams.length}`);
    }

    const countRes = await this.pool.query(
      `SELECT 
         count(*)::int as total_attempted,
         count(*) FILTER (WHERE r.status IN ('failed', 'uncertain'))::int as failed_count
       FROM public.monitoring_runs r
       WHERE ${countConditions.join(" AND ")}`,
      countParams,
    );
    const totalAttempted = countRes.rows[0]?.total_attempted ?? 0;
    const failedCount = countRes.rows[0]?.failed_count ?? 0;

    // 2. Fetch valid runs joined with answer, mentions, citations
    const runConditions = [...countConditions, "r.status IN ('succeeded', 'refused')"];
    const runsRes = await this.pool.query<RunRow>(
      `SELECT 
         r.id as run_id,
         coalesce(a.prompt_id, (r.request->>'promptId')::uuid) as prompt_id,
         coalesce(a.engine, r.request->>'engine', 'gemini') as engine,
         coalesce(a.geo, r.request->>'geo', 'US') as geo,
         coalesce(a.language, r.request->>'language', 'en') as language,
         r.status,
         to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as run_date,
         r.created_at,
         1::int as priority,
         1.0::float as weight,
         a.id as answer_id,
         coalesce(a.has_citations, false) as has_citations,
         EXISTS (
           SELECT 1 FROM public.mentions m 
           WHERE m.answer_id = a.id AND m.entity_type = 'brand'
         ) as has_brand_mention,
         (
           SELECT min(coalesce(m.list_rank, 1))::int 
           FROM public.mentions m 
           WHERE m.answer_id = a.id AND m.entity_type = 'brand'
         ) as brand_min_rank,
         (
           SELECT m.sentiment::int 
           FROM public.mentions m 
           WHERE m.answer_id = a.id AND m.entity_type = 'brand' AND m.confidence >= 0.60 
           ORDER BY m.confidence DESC, m.position_index ASC 
           LIMIT 1
         ) as brand_sentiment,
         EXISTS (
           SELECT 1 FROM public.citations c 
           JOIN public.projects proj ON proj.id = c.project_id
           WHERE c.answer_id = a.id 
             AND (
               c.domain = proj.domain 
               OR proj.domain LIKE '%' || c.domain || '%' 
               OR c.domain LIKE '%' || replace(replace(proj.domain, 'https://', ''), 'http://', '') || '%'
             )
         ) as has_brand_citation,
         coalesce((SELECT count(*)::int FROM public.citations c WHERE c.answer_id = a.id), 0) as citations_count
       FROM public.monitoring_runs r
       LEFT JOIN public.answers a ON a.run_id = r.id
       WHERE ${runConditions.join(" AND ")}
       ORDER BY r.created_at ASC`,
      countParams,
    );

    // 3. Fetch competitor mentions
    const compMentionsRes = await this.pool.query<CompetitorMentionRow>(
      `SELECT 
         m.entity_id as competitor_id,
         m.entity_name as competitor_name,
         r.id as run_id,
         coalesce(a.engine, r.request->>'engine', 'gemini') as engine,
         to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as run_date
       FROM public.mentions m
       JOIN public.answers a ON a.id = m.answer_id
       JOIN public.monitoring_runs r ON r.id = a.run_id
       WHERE ${runConditions.join(" AND ")} AND m.entity_type = 'competitor'`,
      countParams,
    );

    return {
      runs: runsRes.rows,
      competitorMentions: compMentionsRes.rows,
      totalAttempted,
      failedCount,
    };
  }

  private calculateMetricsForDataset(
    runs: RunRow[],
    competitorMentions: CompetitorMentionRow[],
    competitorList: Array<{ id: string; name: string; domain?: string | null; isDirect?: boolean }>,
    promptsList: Array<{ id: string; text: string; priority: number }>,
  ) {
    const totalValidRuns = runs.length;

    // 1. Prompt-weighted Visibility Rate (V)
    // Formula: V = sum_p (w_p * (m_p / n_p)) / sum_p w_p
    const promptMap = new Map<
      string,
      { total: number; brandMentioned: number; weight: number; ranks: number[] }
    >();

    // Initialize with known prompts if available
    for (const p of promptsList) {
      promptMap.set(p.id, {
        total: 0,
        brandMentioned: 0,
        weight: Math.max(0.2, (p.priority || 1) / 5),
        ranks: [],
      });
    }

    let brandMentionedTotal = 0;
    let recommendedTotal = 0;
    const brandRanks: number[] = [];
    const sentimentValues: number[] = [];
    let runsWithCitationsTotal = 0;
    let brandCitedTotal = 0;

    for (const r of runs) {
      const pId = r.prompt_id || "unassigned";
      let entry = promptMap.get(pId);
      if (!entry) {
        entry = {
          total: 0,
          brandMentioned: 0,
          weight: Math.max(0.2, (r.priority || 1) / 5),
          ranks: [],
        };
        promptMap.set(pId, entry);
      }
      entry.total += 1;

      if (r.has_brand_mention) {
        entry.brandMentioned += 1;
        brandMentionedTotal += 1;
        if (r.brand_min_rank != null) {
          entry.ranks.push(r.brand_min_rank);
          brandRanks.push(r.brand_min_rank);
        }
        if (r.brand_sentiment != null) {
          sentimentValues.push(r.brand_sentiment);
        }
        if (r.brand_sentiment === 1 && r.brand_min_rank === 1) {
          recommendedTotal += 1;
        }
      }

      if (r.has_citations || r.citations_count > 0) {
        runsWithCitationsTotal += 1;
        if (r.has_brand_citation) {
          brandCitedTotal += 1;
        }
      }
    }

    // Weighted Visibility Rate
    let weightedVisSum = 0;
    let totalWeightSum = 0;
    for (const [, val] of promptMap.entries()) {
      if (val.total > 0) {
        const rate = val.brandMentioned / val.total;
        weightedVisSum += val.weight * rate;
        totalWeightSum += val.weight;
      }
    }
    const visibilityRate =
      totalWeightSum > 0
        ? Number((weightedVisSum / totalWeightSum).toFixed(4))
        : totalValidRuns > 0
          ? Number((brandMentionedTotal / totalValidRuns).toFixed(4))
          : 0;

    const visConfidence = evaluateConfidence(totalValidRuns);
    const visWilson = calculateWilsonInterval(brandMentionedTotal, totalValidRuns);

    // Recommended Rate
    const recommendedRate =
      totalValidRuns > 0 ? Number((recommendedTotal / totalValidRuns).toFixed(4)) : 0;
    const recWilson = calculateWilsonInterval(recommendedTotal, totalValidRuns);

    // Position Score (mean of 1 / rank) & Average Rank
    const mentionCount = brandRanks.length;
    const posConfidence = evaluateConfidence(mentionCount);
    let positionScore = 0;
    let averageRank: number | null = null;
    if (mentionCount > 0) {
      const sumReciprocal = brandRanks.reduce((acc, r) => acc + 1 / Math.max(1, r), 0);
      positionScore = Number((sumReciprocal / mentionCount).toFixed(4));
      const sumRank = brandRanks.reduce((acc, r) => acc + r, 0);
      averageRank = Number((sumRank / mentionCount).toFixed(2));
    }

    // Sentiment Score (mean(s) + 1) / 2
    let sentimentScore = 0.5;
    let netSentiment = 0;
    const sentCount = sentimentValues.length;
    const sentConfidence = evaluateConfidence(sentCount);
    if (sentCount > 0) {
      const sumS = sentimentValues.reduce((acc, s) => acc + s, 0);
      const meanS = sumS / sentCount;
      sentimentScore = Number(((meanS + 1) / 2).toFixed(4));

      const posCount = sentimentValues.filter((s) => s > 0).length;
      const negCount = sentimentValues.filter((s) => s < 0).length;
      netSentiment = Number((((posCount - negCount) / sentCount) * 100).toFixed(1));
    }

    // Citation Rate (CR)
    const crConfidence = evaluateConfidence(runsWithCitationsTotal);
    const citationRate =
      runsWithCitationsTotal > 0
        ? Number((brandCitedTotal / runsWithCitationsTotal).toFixed(4))
        : 0;
    const crWilson = calculateWilsonInterval(brandCitedTotal, runsWithCitationsTotal);

    // Competitor Visibility & Share of Voice
    // Group competitor mentions by competitor
    const compMentionsCountMap = new Map<string, number>();
    for (const cm of competitorMentions) {
      const key = cm.competitor_id || cm.competitor_name;
      compMentionsCountMap.set(key, (compMentionsCountMap.get(key) || 0) + 1);
    }

    const competitorBreakdown: CompetitorVisibility[] = competitorList.map((comp) => {
      const count = compMentionsCountMap.get(comp.id) || compMentionsCountMap.get(comp.name) || 0;
      const rate = totalValidRuns > 0 ? Number((count / totalValidRuns).toFixed(4)) : 0;
      return {
        id: comp.id,
        name: comp.name,
        domain: comp.domain,
        isDirect: comp.isDirect,
        visibilityRate: rate,
        shareOfVoice: 0, // calculated below
        mentionCount: count,
      };
    });

    const totalVisibilitySum =
      visibilityRate + competitorBreakdown.reduce((acc, c) => acc + c.visibilityRate, 0);
    const shareOfVoice =
      totalVisibilitySum > 0 ? Number((visibilityRate / totalVisibilitySum).toFixed(4)) : 0;

    for (const comp of competitorBreakdown) {
      comp.shareOfVoice =
        totalVisibilitySum > 0 ? Number((comp.visibilityRate / totalVisibilitySum).toFixed(4)) : 0;
    }

    // Composite AI Visibility Score (0-100)
    const composite = calculateCompositeScore({
      visibilityRate,
      shareOfVoice,
      competitorCount: competitorList.length,
      positionScore,
      sentimentScore,
      citationRate,
    });

    return {
      visibilityRate,
      visWilson,
      visConfidence,
      recommendedRate,
      recWilson,
      positionScore,
      averageRank,
      posConfidence,
      sentimentScore,
      netSentiment,
      sentConfidence,
      citationRate,
      crWilson,
      crConfidence,
      shareOfVoice,
      competitorBreakdown,
      composite,
      brandMentionedTotal,
      recommendedTotal,
      runsWithCitationsTotal,
      brandCitedTotal,
      totalValidRuns,
      promptMap,
    };
  }

  async getVisibilityOverview(
    context: TenantContext,
    projectId: string,
    query: VisibilityQuery = {},
  ): Promise<VisibilityOverview> {
    const project = await this.assertProjectAccess(context, projectId);
    const windows = this.resolveDateWindows(query);

    // Fetch competitors & prompts
    const [compRes, promptsRes] = await Promise.all([
      this.pool.query<{ id: string; name: string; domain: string | null }>(
        `SELECT id, name, domain FROM public.competitors WHERE project_id = $1 AND tenant_id = $2`,
        [projectId, context.tenantId],
      ),
      this.pool.query<{ id: string; text: string; priority: number }>(
        `SELECT id, body as text, 1::int as priority FROM public.monitoring_prompts WHERE project_id = $1 AND tenant_id = $2`,
        [projectId, context.tenantId],
      ),
    ]);

    const competitorList = compRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
    }));
    const promptsList = promptsRes.rows;

    // Fetch current and previous runs
    const [currentData, previousData] = await Promise.all([
      this.fetchRunsForWindow(
        context,
        projectId,
        windows.current.from,
        windows.current.to,
        query.engine,
        query.market,
      ),
      this.fetchRunsForWindow(
        context,
        projectId,
        windows.previous.from,
        windows.previous.to,
        query.engine,
        query.market,
      ),
    ]);

    const currentMetrics = this.calculateMetricsForDataset(
      currentData.runs,
      currentData.competitorMentions,
      competitorList,
      promptsList,
    );

    const prevMetrics = this.calculateMetricsForDataset(
      previousData.runs,
      previousData.competitorMentions,
      competitorList,
      promptsList,
    );

    // Calculate deltas
    const calcDelta = (cur: number, prev: number) => {
      const delta = Number((cur - prev).toFixed(4));
      const deltaPercent = prev > 0 ? Number((((cur - prev) / prev) * 100).toFixed(1)) : undefined;
      return { delta, deltaPercent };
    };

    const visDelta = calcDelta(currentMetrics.visibilityRate, prevMetrics.visibilityRate);
    const sovDelta = calcDelta(currentMetrics.shareOfVoice, prevMetrics.shareOfVoice);
    const posDelta = calcDelta(currentMetrics.positionScore, prevMetrics.positionScore);
    const sentDelta = calcDelta(currentMetrics.sentimentScore, prevMetrics.sentimentScore);
    const crDelta = calcDelta(currentMetrics.citationRate, prevMetrics.citationRate);
    const recDelta = calcDelta(currentMetrics.recommendedRate, prevMetrics.recommendedRate);
    const compDelta = calcDelta(currentMetrics.composite.score, prevMetrics.composite.score);

    // Engine breakdown
    const enginesList = ["openai", "gemini", "google_ai_overviews", "google_ai_mode", "openrouter"];
    const engineNames: Record<string, string> = {
      openai: "ChatGPT (Search)",
      gemini: "Google Gemini",
      openrouter: "OpenRouter / GPT-6 Luna",
      google_ai_overviews: "Google AI Overviews",
      google_ai_mode: "Google AI Mode",
    };

    const engines: EngineBreakdown[] = enginesList.map((eng) => {
      const engRuns = currentData.runs.filter((r) => r.engine === eng);
      const engCompMentions = currentData.competitorMentions.filter((m) => m.engine === eng);
      const m = this.calculateMetricsForDataset(
        engRuns,
        engCompMentions,
        competitorList,
        promptsList,
      );
      return {
        engine: eng,
        name: engineNames[eng] || eng,
        visibilityRate: m.visibilityRate,
        n: m.totalValidRuns,
        positionScore: m.positionScore,
        sentimentScore: m.sentimentScore,
        citationRate: m.citationRate,
        compositeScore: m.composite.score,
        grade: m.composite.grade,
      };
    });

    // Prompts breakdown
    const promptsBreakdown: PromptVisibilityBreakdown[] = promptsList.map((p) => {
      const data = currentMetrics.promptMap.get(p.id) || {
        total: 0,
        brandMentioned: 0,
        ranks: [],
      };
      const vRate = data.total > 0 ? Number((data.brandMentioned / data.total).toFixed(4)) : 0;
      const avgRank =
        data.ranks.length > 0
          ? Number((data.ranks.reduce((a, b) => a + b, 0) / data.ranks.length).toFixed(1))
          : null;
      return {
        promptId: p.id,
        text: p.text,
        priority: p.priority,
        totalRuns: data.total,
        mentionedRuns: data.brandMentioned,
        visibilityRate: vRate,
        averageRank: avgRank,
      };
    });

    const failureRate =
      currentData.totalAttempted > 0
        ? Number(((currentData.failedCount / currentData.totalAttempted) * 100).toFixed(1))
        : 0;

    return {
      project: {
        id: project.id,
        brandName: project.brand_name,
        domain: project.domain,
        description: project.description,
      },
      timeWindow: {
        current: {
          from: windows.current.fromStr,
          to: windows.current.toStr,
          days: windows.current.days,
        },
        previous: {
          from: windows.previous.fromStr,
          to: windows.previous.toStr,
          days: windows.previous.days,
        },
      },
      composite: {
        score: currentMetrics.composite.score,
        grade: currentMetrics.composite.grade,
        label: "Modeled",
        delta: compDelta.delta,
        deltaPercent: compDelta.deltaPercent,
        fairShare: currentMetrics.composite.fairShare,
        sovRatio: currentMetrics.composite.sovRatio,
      },
      metrics: {
        visibilityRate: {
          value: currentMetrics.visibilityRate,
          label: "Observed",
          n: currentMetrics.totalValidRuns,
          ciLow: currentMetrics.visWilson.low,
          ciHigh: currentMetrics.visWilson.high,
          confidenceTier: currentMetrics.visConfidence.tier,
          confidenceLabel: currentMetrics.visConfidence.label,
          displayable: currentMetrics.visConfidence.displayable,
          delta: visDelta.delta,
          deltaPercent: visDelta.deltaPercent,
        },
        shareOfVoice: {
          value: currentMetrics.shareOfVoice,
          label: "Modeled",
          n: currentMetrics.totalValidRuns,
          confidenceTier: currentMetrics.visConfidence.tier,
          confidenceLabel: currentMetrics.visConfidence.label,
          displayable: currentMetrics.visConfidence.displayable,
          delta: sovDelta.delta,
          deltaPercent: sovDelta.deltaPercent,
        },
        positionScore: {
          value: currentMetrics.positionScore,
          label: "Observed",
          n: currentMetrics.brandMentionedTotal,
          confidenceTier: currentMetrics.posConfidence.tier,
          confidenceLabel: currentMetrics.posConfidence.label,
          displayable: currentMetrics.posConfidence.displayable,
          delta: posDelta.delta,
          deltaPercent: posDelta.deltaPercent,
        },
        sentimentScore: {
          value: currentMetrics.sentimentScore,
          label: "Estimated",
          n: currentMetrics.sentConfidence.n,
          confidenceTier: currentMetrics.sentConfidence.tier,
          confidenceLabel: currentMetrics.sentConfidence.label,
          displayable: currentMetrics.sentConfidence.displayable,
          delta: sentDelta.delta,
          deltaPercent: sentDelta.deltaPercent,
        },
        citationRate: {
          value: currentMetrics.citationRate,
          label: "Observed",
          n: currentMetrics.runsWithCitationsTotal,
          ciLow: currentMetrics.crWilson.low,
          ciHigh: currentMetrics.crWilson.high,
          confidenceTier: currentMetrics.crConfidence.tier,
          confidenceLabel: currentMetrics.crConfidence.label,
          displayable: currentMetrics.crConfidence.displayable,
          delta: crDelta.delta,
          deltaPercent: crDelta.deltaPercent,
        },
        recommendedRate: {
          value: currentMetrics.recommendedRate,
          label: "Modeled",
          n: currentMetrics.totalValidRuns,
          ciLow: currentMetrics.recWilson.low,
          ciHigh: currentMetrics.recWilson.high,
          confidenceTier: currentMetrics.visConfidence.tier,
          confidenceLabel: currentMetrics.visConfidence.label,
          displayable: currentMetrics.visConfidence.displayable,
          delta: recDelta.delta,
          deltaPercent: recDelta.deltaPercent,
        },
        netSentiment: {
          value: currentMetrics.netSentiment,
          label: "Estimated",
        },
      },
      sampleSummary: {
        totalValidRuns: currentMetrics.totalValidRuns,
        brandMentionedRuns: currentMetrics.brandMentionedTotal,
        runsWithCitations: currentMetrics.runsWithCitationsTotal,
        brandCitedRuns: currentMetrics.brandCitedTotal,
        failureRate,
        totalRunsAttempted: currentData.totalAttempted,
      },
      competitors: currentMetrics.competitorBreakdown,
      engines,
      prompts: promptsBreakdown,
    };
  }

  async getTrend(
    context: TenantContext,
    projectId: string,
    query: VisibilityQuery = {},
  ): Promise<TrendResponse> {
    await this.assertProjectAccess(context, projectId);
    const windows = this.resolveDateWindows(query);

    // Fetch competitors & prompts
    const compRes = await this.pool.query<{ id: string; name: string; domain: string | null }>(
      `SELECT id, name, domain FROM public.competitors WHERE project_id = $1 AND tenant_id = $2`,
      [projectId, context.tenantId],
    );
    const competitorList = compRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
    }));

    const data = await this.fetchRunsForWindow(
      context,
      projectId,
      windows.current.from,
      windows.current.to,
      query.engine,
      query.market,
    );

    // Group runs by date YYYY-MM-DD
    const dateMap = new Map<string, { runs: RunRow[]; compMentions: CompetitorMentionRow[] }>();

    // Seed all dates in window
    const dayMs = 86400 * 1000;
    const startT = windows.current.from.getTime();
    const endT = windows.current.to.getTime();
    for (let t = startT; t <= endT; t += dayMs) {
      const dStr = new Date(t).toISOString().slice(0, 10);
      if (!dateMap.has(dStr)) {
        dateMap.set(dStr, { runs: [], compMentions: [] });
      }
    }

    for (const r of data.runs) {
      const entry = dateMap.get(r.run_date);
      if (entry) entry.runs.push(r);
    }
    for (const cm of data.competitorMentions) {
      const entry = dateMap.get(cm.run_date);
      if (entry) entry.compMentions.push(cm);
    }

    const rawPoints: Array<{
      date: string;
      value: number;
      sampleSize: number;
      shareOfVoice: number;
      citationRate: number;
      compositeScore: number;
      grade: GradeBand;
    }> = [];

    const sortedDates = Array.from(dateMap.keys()).sort();
    for (const d of sortedDates) {
      const bucket = dateMap.get(d)!;
      const m = this.calculateMetricsForDataset(
        bucket.runs,
        bucket.compMentions,
        competitorList,
        [],
      );
      rawPoints.push({
        date: d,
        value: m.visibilityRate,
        sampleSize: m.totalValidRuns,
        shareOfVoice: m.shareOfVoice,
        citationRate: m.citationRate,
        compositeScore: m.composite.score,
        grade: m.composite.grade,
      });
    }

    // Apply 7-day rolling smoothing (VIS-FR-010)
    const smoothed = calculateRollingAverage(rawPoints, 7);

    const points: TrendDataPoint[] = smoothed.map((p, idx) => ({
      date: p.date,
      value: p.value,
      visibilityRate: p.value,
      sampleSize: rawPoints[idx].sampleSize,
      shareOfVoice: rawPoints[idx].shareOfVoice,
      citationRate: rawPoints[idx].citationRate,
      compositeScore: rawPoints[idx].compositeScore,
      grade: rawPoints[idx].grade,
      rollingAvg: p.rollingAvg,
    }));

    // System and project event annotations (VIS-FR-010)
    const events: TrendResponse["events"] = [
      {
        date: windows.current.fromStr,
        title: "Monitoring Baseline Established",
        description: "Automated multi-engine collection active across targeted prompts",
        type: "milestone",
      },
    ];

    return { points, events };
  }

  async getAnomalies(
    context: TenantContext,
    projectId: string,
    query: VisibilityQuery = {},
  ): Promise<{ anomalies: AnomalyCandidate[]; totalEvaluated: number; fdrQ: number }> {
    const overview = await this.getVisibilityOverview(context, projectId, query);
    const candidateList: AnomalyCandidate[] = [];

    // 1. Overall brand visibility shift test (Current vs Previous)
    const curV = overview.metrics.visibilityRate;
    const curRuns = overview.sampleSummary.totalValidRuns;
    const curMentions = overview.sampleSummary.brandMentionedRuns;

    // Previous window run estimate
    const prevRuns = Math.max(0, Math.round(curRuns - (curV.delta || 0) * curRuns));
    const prevV = Math.max(0, Math.min(1, curV.value - (curV.delta || 0)));
    const prevMentions = Math.round(prevV * prevRuns);

    const overallZ = calculateTwoProportionZTest(curMentions, curRuns, prevMentions, prevRuns);
    candidateList.push({
      id: "overall_visibility_rate",
      metric: "visibility_rate",
      entityName: overview.project.brandName,
      engine: query.engine || "all",
      currentValue: curV.value,
      previousValue: prevV,
      currentN: curRuns,
      previousN: prevRuns,
      delta: curV.delta || 0,
      pValue: overallZ.pValue,
      significant: overallZ.significant,
    });

    // 2. Engine level shifts
    for (const eng of overview.engines) {
      if (eng.n >= 5) {
        // Compare engine vs other engines pooled
        const otherRuns = overview.sampleSummary.totalValidRuns - eng.n;
        const engMentions = Math.round(eng.visibilityRate * eng.n);
        const otherMentions = Math.max(0, curMentions - engMentions);

        const engZ = calculateTwoProportionZTest(engMentions, eng.n, otherMentions, otherRuns);
        candidateList.push({
          id: `engine_shift_${eng.engine}`,
          metric: "engine_visibility_divergence",
          entityName: overview.project.brandName,
          engine: eng.engine,
          currentValue: eng.visibilityRate,
          previousValue: otherRuns > 0 ? Number((otherMentions / otherRuns).toFixed(4)) : 0,
          currentN: eng.n,
          previousN: otherRuns,
          delta: engZ.delta,
          pValue: engZ.pValue,
          significant: engZ.significant,
        });
      }
    }

    // 3. Competitor visibility spikes
    for (const comp of overview.competitors) {
      if (comp.mentionCount > 0 && curRuns >= 5) {
        const compZ = calculateTwoProportionZTest(comp.mentionCount, curRuns, curMentions, curRuns);
        candidateList.push({
          id: `competitor_spike_${comp.id}`,
          metric: "competitor_share_spike",
          entityName: comp.name,
          engine: query.engine || "all",
          currentValue: comp.visibilityRate,
          previousValue: curV.value,
          currentN: curRuns,
          previousN: curRuns,
          delta: compZ.delta,
          pValue: compZ.pValue,
          significant: compZ.significant,
        });
      }
    }

    // Apply Benjamini-Hochberg FDR procedure at q = 0.05
    const adjusted = applyBenjaminiHochberg(candidateList, 0.05);

    return {
      anomalies: adjusted.filter((a) => a.significant),
      totalEvaluated: candidateList.length,
      fdrQ: 0.05,
    };
  }

  async exportCsv(
    context: TenantContext,
    projectId: string,
    query: VisibilityQuery = {},
  ): Promise<string> {
    const overview = await this.getVisibilityOverview(context, projectId, query);

    const headers = [
      "ProjectID",
      "BrandName",
      "DateFrom",
      "DateTo",
      "Engine",
      "Market",
      "MetricName",
      "MetricLabel",
      "Value",
      "SampleSize_N",
      "CI_Low_95",
      "CI_High_95",
      "ConfidenceTier",
    ];

    const rows: string[][] = [];
    const p = overview.project;
    const tw = overview.timeWindow.current;
    const eng = query.engine || "all";
    const mkt = query.market || "all";

    const addRow = (
      name: string,
      label: string,
      val: number,
      n: number,
      ciLow?: number,
      ciHigh?: number,
      tier: string = "adequate",
    ) => {
      rows.push([
        p.id,
        `"${p.brandName.replaceAll('"', '""')}"`,
        tw.from,
        tw.to,
        eng,
        mkt,
        name,
        label,
        val.toFixed(4),
        n.toString(),
        ciLow !== undefined ? ciLow.toFixed(4) : "",
        ciHigh !== undefined ? ciHigh.toFixed(4) : "",
        tier,
      ]);
    };

    addRow(
      "composite_score",
      "Modeled",
      overview.composite.score,
      overview.sampleSummary.totalValidRuns,
      undefined,
      undefined,
      "adequate",
    );
    addRow(
      "visibility_rate",
      "Observed",
      overview.metrics.visibilityRate.value,
      overview.metrics.visibilityRate.n,
      overview.metrics.visibilityRate.ciLow,
      overview.metrics.visibilityRate.ciHigh,
      overview.metrics.visibilityRate.confidenceTier,
    );
    addRow(
      "share_of_voice",
      "Modeled",
      overview.metrics.shareOfVoice.value,
      overview.metrics.shareOfVoice.n,
      undefined,
      undefined,
      overview.metrics.shareOfVoice.confidenceTier,
    );
    addRow(
      "position_score",
      "Observed",
      overview.metrics.positionScore.value,
      overview.metrics.positionScore.n,
      undefined,
      undefined,
      overview.metrics.positionScore.confidenceTier,
    );
    addRow(
      "sentiment_score",
      "Estimated",
      overview.metrics.sentimentScore.value,
      overview.metrics.sentimentScore.n,
      undefined,
      undefined,
      overview.metrics.sentimentScore.confidenceTier,
    );
    addRow(
      "citation_rate",
      "Observed",
      overview.metrics.citationRate.value,
      overview.metrics.citationRate.n,
      overview.metrics.citationRate.ciLow,
      overview.metrics.citationRate.ciHigh,
      overview.metrics.citationRate.confidenceTier,
    );
    addRow(
      "recommended_rate",
      "Modeled",
      overview.metrics.recommendedRate.value,
      overview.metrics.recommendedRate.n,
      overview.metrics.recommendedRate.ciLow,
      overview.metrics.recommendedRate.ciHigh,
      overview.metrics.recommendedRate.confidenceTier,
    );

    for (const comp of overview.competitors) {
      addRow(
        `competitor_visibility_${comp.name.toLowerCase().replaceAll(/\s+/g, "_")}`,
        "Observed",
        comp.visibilityRate,
        comp.mentionCount,
      );
      addRow(
        `competitor_sov_${comp.name.toLowerCase().replaceAll(/\s+/g, "_")}`,
        "Modeled",
        comp.shareOfVoice,
        comp.mentionCount,
      );
    }

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  }

  // Saved Views Management (VIS-FR-011)
  async listSavedViews(context: TenantContext, projectId: string) {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `SELECT id, tenant_id, project_id, user_id, name, filters, created_at 
       FROM public.saved_views 
       WHERE project_id = $1 AND tenant_id = $2 
       ORDER BY created_at DESC`,
      [projectId, context.tenantId],
    );
    return res.rows;
  }

  async createSavedView(context: TenantContext, projectId: string, input: SavedViewInput) {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `INSERT INTO public.saved_views (tenant_id, project_id, user_id, name, filters)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, project_id, user_id, name, filters, created_at`,
      [context.tenantId, projectId, context.userId, input.name, JSON.stringify(input.filters)],
    );
    return res.rows[0];
  }

  async deleteSavedView(context: TenantContext, projectId: string, viewId: string) {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `DELETE FROM public.saved_views 
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3 
       RETURNING id`,
      [viewId, projectId, context.tenantId],
    );
    if (!res.rows.length) {
      throw new ApiError(404, "Saved view not found", "NOT_FOUND");
    }
    return { success: true, id: viewId };
  }

  // Metric Goals Management (VIS-FR-011)
  async listMetricGoals(context: TenantContext, projectId: string) {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `SELECT id, tenant_id, project_id, metric_name, target_value::float, deadline, status, created_at 
       FROM public.metric_goals 
       WHERE project_id = $1 AND tenant_id = $2 
       ORDER BY created_at DESC`,
      [projectId, context.tenantId],
    );
    return res.rows;
  }

  async createMetricGoal(context: TenantContext, projectId: string, input: MetricGoalInput) {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `INSERT INTO public.metric_goals (tenant_id, project_id, metric_name, target_value, deadline, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id, project_id, metric_name, target_value::float, deadline, status, created_at`,
      [
        context.tenantId,
        projectId,
        input.metricName,
        input.targetValue,
        input.deadline || null,
        input.status || "active",
      ],
    );
    return res.rows[0];
  }

  async deleteMetricGoal(context: TenantContext, projectId: string, goalId: string) {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `DELETE FROM public.metric_goals 
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3 
       RETURNING id`,
      [goalId, projectId, context.tenantId],
    );
    if (!res.rows.length) {
      throw new ApiError(404, "Metric goal not found", "NOT_FOUND");
    }
    return { success: true, id: goalId };
  }

  // Daily Fact Aggregation & Persistence (VIS-FR-001 & Section 6.2)
  async aggregateDailyFacts(
    tenantId: string,
    projectId: string,
    targetDate: string, // YYYY-MM-DD
  ): Promise<number> {
    const overview = await this.getVisibilityOverview(
      { tenantId, userId: "00000000-0000-0000-0000-000000000000" },
      projectId,
      { dateFrom: targetDate, dateTo: targetDate },
    );

    const factsToInsert = [
      {
        metricName: "visibility_rate",
        value: overview.metrics.visibilityRate.value,
        n: overview.metrics.visibilityRate.n,
        ciLow: overview.metrics.visibilityRate.ciLow,
        ciHigh: overview.metrics.visibilityRate.ciHigh,
        label: "Observed",
      },
      {
        metricName: "share_of_voice",
        value: overview.metrics.shareOfVoice.value,
        n: overview.metrics.shareOfVoice.n,
        ciLow: undefined,
        ciHigh: undefined,
        label: "Modeled",
      },
      {
        metricName: "position_score",
        value: overview.metrics.positionScore.value,
        n: overview.metrics.positionScore.n,
        ciLow: undefined,
        ciHigh: undefined,
        label: "Observed",
      },
      {
        metricName: "sentiment_score",
        value: overview.metrics.sentimentScore.value,
        n: overview.metrics.sentimentScore.n,
        ciLow: undefined,
        ciHigh: undefined,
        label: "Estimated",
      },
      {
        metricName: "citation_rate",
        value: overview.metrics.citationRate.value,
        n: overview.metrics.citationRate.n,
        ciLow: overview.metrics.citationRate.ciLow,
        ciHigh: overview.metrics.citationRate.ciHigh,
        label: "Observed",
      },
      {
        metricName: "composite_score",
        value: overview.composite.score,
        n: overview.sampleSummary.totalValidRuns,
        ciLow: undefined,
        ciHigh: undefined,
        label: "Modeled",
      },
    ];

    let inserted = 0;
    for (const f of factsToInsert) {
      await this.pool.query(
        `INSERT INTO public.metric_facts (
           tenant_id, project_id, date, engine, market, entity_id, entity_type, 
           metric_name, value, n, ci_low, ci_high, label
         )
         VALUES ($1, $2, $3, 'all', 'all', NULL, 'brand', $4, $5, $6, $7, $8, $9)
         ON CONFLICT (project_id, date, engine, market, entity_id, metric_name)
         DO UPDATE SET 
           value = EXCLUDED.value,
           n = EXCLUDED.n,
           ci_low = EXCLUDED.ci_low,
           ci_high = EXCLUDED.ci_high,
           label = EXCLUDED.label`,
        [
          tenantId,
          projectId,
          targetDate,
          f.metricName,
          f.value,
          f.n,
          f.ciLow ?? null,
          f.ciHigh ?? null,
          f.label,
        ],
      );
      inserted++;
    }

    return inserted;
  }
}
