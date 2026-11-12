import type { Pool } from "pg";
import { calculateWilsonInterval } from "./statistics.js";
import { ApiError } from "../../utils/ApiError.js";

export type CompetitorType = "direct" | "indirect" | "aspirational";
export type CandidateEntityType = "competitor" | "marketplace" | "publisher" | "tool" | "other";
export type CandidateStatus = "suggested" | "accepted" | "rejected" | "snoozed";
export type HeadToHeadOutcome = "win" | "loss" | "tie";

export interface TenantContext {
  tenantId: string;
  userId: string;
}

export interface CompetitorQuery {
  days?: number;
  dateFrom?: string;
  dateTo?: string;
  engine?: string;
  topic?: string;
  nonBrandedOnly?: boolean;
  search?: string;
}

export interface CompetitorItem {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
  competitorType: CompetitorType;
  rationale?: string | null;
  discoveredVia: string;
  createdAt: string;
  updatedAt: string;
  metrics: {
    visibilityRate: number;
    shareOfVoice: number;
    avgPosition: number;
    sentimentScore: number;
    citationsCount: number;
    headToHead: {
      wins: number;
      losses: number;
      ties: number;
      winRate: number;
    };
  };
}

export interface LeaderboardItem {
  rank: number;
  rankDelta: number;
  entityId: string;
  name: string;
  domain: string;
  isBrand: boolean;
  competitorType?: CompetitorType | null;
  visibilityRate: number;
  ciLow: number;
  ciHigh: number;
  shareOfVoice: number;
  fairShare: number;
  positionScore: number;
  avgPosition: number;
  sentimentScore: number;
  citationShare: number;
  headToHeadWinRate: number; // Win rate of brand against this competitor
}

export interface HeadToHeadPromptItem {
  promptId: string;
  promptText: string;
  priority: number;
  brandRank: number | null;
  competitorRank: number | null;
  brandVis: number;
  competitorVis: number;
  outcome: HeadToHeadOutcome;
  engines: string[];
}

export interface HeadToHeadResponse {
  competitor: {
    id: string;
    name: string;
    domain: string;
    competitorType: CompetitorType;
  };
  summary: {
    wins: number;
    losses: number;
    ties: number;
    totalPrompts: number;
    winRate: number;
    brandVisibilityRate: number;
    competitorVisibilityRate: number;
  };
  prompts: HeadToHeadPromptItem[];
}

export interface CompetitiveGapItem {
  promptId: string;
  promptText: string;
  priority: number;
  competitorId: string;
  competitorName: string;
  competitorVis: number;
  brandVis: number;
  gapScore: number;
  promptWeight: number;
  demandIndex: number;
  reasons: string[];
  engines: string[];
}

export interface CompetitorCandidateItem {
  id: string;
  name: string;
  domain: string | null;
  mentionCount: number;
  mentionFrequency: number;
  coOccurrenceCount: number;
  engines: string[];
  sampleAnswerIds: string[];
  entityType: CandidateEntityType;
  status: CandidateStatus;
  rejectedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

const COMMON_AMBIGUOUS_NAMES = new Set([
  "apple",
  "target",
  "box",
  "square",
  "monday",
  "stripe",
  "amazon",
  "google",
  "meta",
  "notion",
  "clickup",
  "zoom",
  "slack",
  "scale",
  "ramp",
  "blend",
  "nest",
  "wave",
  "canvas",
  "pilot",
  "carta",
  "gusto",
  "loom",
  "front",
  "figma",
  "linear",
]);

export class CompetitorService {
  constructor(private readonly pool: Pool) {}

  private async assertProjectAccess(context: TenantContext, projectId: string) {
    const res = await this.pool.query(
      `SELECT id, tenant_id, brand_name, domain, aliases, description 
       FROM public.projects 
       WHERE id = $1 AND tenant_id = $2`,
      [projectId, context.tenantId],
    );
    if (!res.rows.length) {
      throw new ApiError(404, "Project not found or access denied", "PROJECT_NOT_FOUND");
    }
    return res.rows[0];
  }

  private normalizeHostname(domainOrUrl: string): string {
    let clean = domainOrUrl.trim().toLowerCase();
    clean = clean.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "");
    const slashIdx = clean.indexOf("/");
    if (slashIdx !== -1) clean = clean.slice(0, slashIdx);
    const colonIdx = clean.indexOf(":");
    if (colonIdx !== -1) clean = clean.slice(0, colonIdx);
    return clean;
  }

  private appendPromptFilters(
    conditions: string[],
    params: unknown[],
    query: CompetitorQuery,
    project: { brand_name: string; domain: string; aliases: unknown },
  ) {
    const promptId = "coalesce(a.prompt_id, (r.request->>'promptId')::uuid)";
    const promptScope = `mp.id = ${promptId} AND mp.project_id = r.project_id AND mp.tenant_id = r.tenant_id`;

    if (query.topic) {
      params.push(query.topic);
      conditions.push(
        `EXISTS (SELECT 1 FROM public.monitoring_prompts mp WHERE ${promptScope} AND $${params.length} = ANY(mp.tags))`,
      );
    }

    if (query.nonBrandedOnly) {
      const aliases = Array.isArray(project.aliases)
        ? project.aliases.filter((alias): alias is string => typeof alias === "string")
        : [];
      const brandTerms = [
        ...new Set(
          [project.brand_name, project.domain, this.normalizeHostname(project.domain), ...aliases]
            .map((term) => term.trim())
            .filter(Boolean),
        ),
      ];
      if (brandTerms.length) {
        const brandedPromptConditions = brandTerms.map((term) => {
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          params.push(`(^|[^[:alnum:]])${escaped}([^[:alnum:]]|$)`);
          return `mp.body ~* $${params.length}`;
        });
        conditions.push(
          `NOT EXISTS (SELECT 1 FROM public.monitoring_prompts mp WHERE ${promptScope} AND (${brandedPromptConditions.join(" OR ")}))`,
        );
      }
    }
  }

  async listTopics(context: TenantContext, projectId: string): Promise<string[]> {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query<{ topic: string }>(
      `SELECT DISTINCT tag AS topic
       FROM public.monitoring_prompts mp
       CROSS JOIN LATERAL unnest(mp.tags) AS topics(tag)
       WHERE mp.project_id = $1 AND mp.tenant_id = $2 AND mp.active = true
         AND tag <> ''
       ORDER BY tag`,
      [projectId, context.tenantId],
    );
    return res.rows.map((row) => row.topic);
  }

  // 1. Competitor Management CRUD (CMP-FR-001, CMP-FR-008)
  async listCompetitors(
    context: TenantContext,
    projectId: string,
    query: { search?: string } = {},
  ): Promise<CompetitorItem[]> {
    const project = await this.assertProjectAccess(context, projectId);
    const brandHost = this.normalizeHostname(project.domain);

    const conditions: string[] = ["c.project_id = $1", "c.tenant_id = $2"];
    const params: unknown[] = [projectId, context.tenantId];

    if (query.search && query.search.trim()) {
      params.push(`%${query.search.trim().toLowerCase()}%`);
      conditions.push(
        `(lower(c.name) LIKE $${params.length} OR lower(c.domain) LIKE $${params.length})`,
      );
    }

    const compRes = await this.pool.query<{
      id: string;
      name: string;
      domain: string;
      aliases: string[];
      competitor_type: CompetitorType;
      rationale: string | null;
      discovered_via: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, domain, aliases, coalesce(competitor_type, 'direct') as competitor_type, 
              rationale, discovered_via, created_at, updated_at
       FROM public.competitors c
       WHERE ${conditions.join(" AND ")}
       ORDER BY c.created_at ASC`,
      params,
    );

    // Compute metrics for each competitor
    const competitorItems: CompetitorItem[] = [];

    // Fetch total completed runs for baseline
    const runsRes = await this.pool.query<{ total_runs: number }>(
      `SELECT count(*)::int as total_runs 
       FROM public.monitoring_runs 
       WHERE project_id = $1 AND tenant_id = $2 AND status IN ('succeeded', 'refused')`,
      [projectId, context.tenantId],
    );
    const totalRuns = runsRes.rows[0]?.total_runs || 0;

    for (const comp of compRes.rows) {
      const normCompHost = this.normalizeHostname(comp.domain);

      // Mentions count, avg position, sentiment
      const mentionRes = await this.pool.query<{
        mention_runs: number;
        avg_pos: number;
        sentiment_score: number;
      }>(
        `SELECT 
           count(DISTINCT a.run_id)::int as mention_runs,
           coalesce(avg(m.position_index), 0)::float as avg_pos,
           coalesce(avg(m.sentiment), 0)::float as sentiment_score
         FROM public.mentions m
         JOIN public.answers a ON a.id = m.answer_id
         JOIN public.monitoring_runs r ON r.id = a.run_id
         WHERE r.project_id = $1 AND r.tenant_id = $2
           AND r.status IN ('succeeded', 'refused')
           AND (m.entity_name = $3 OR m.entity_type = 'competitor' AND lower(m.entity_name) = lower($3))`,
        [projectId, context.tenantId, comp.name],
      );
      const mentionRuns = mentionRes.rows[0]?.mention_runs || 0;
      const visRate = totalRuns > 0 ? Number((mentionRuns / totalRuns).toFixed(4)) : 0;
      const avgPos = Number((mentionRes.rows[0]?.avg_pos || 0).toFixed(1));
      const sentimentScore = Number((mentionRes.rows[0]?.sentiment_score || 0).toFixed(2));

      // Citations count
      const citRes = await this.pool.query<{ cit_count: number }>(
        `SELECT count(*)::int as cit_count
         FROM public.citations c
         JOIN public.answers a ON a.id = c.answer_id
         JOIN public.monitoring_runs r ON r.id = a.run_id
         WHERE r.project_id = $1 AND r.tenant_id = $2
           AND r.status IN ('succeeded', 'refused')
           AND (c.domain = $3 OR c.domain LIKE '%' || $3 || '%' OR c.source_type = 'competitor')`,
        [projectId, context.tenantId, normCompHost],
      );
      const citCount = citRes.rows[0]?.cit_count || 0;

      // Head-to-head against brand on prompt level
      const h2h = await this.computeHeadToHeadSummary(context, projectId, comp.name, brandHost);

      competitorItems.push({
        id: comp.id,
        name: comp.name,
        domain: comp.domain,
        aliases: comp.aliases || [],
        competitorType: comp.competitor_type || "direct",
        rationale: comp.rationale,
        discoveredVia: comp.discovered_via,
        createdAt: comp.created_at.toISOString(),
        updatedAt: comp.updated_at.toISOString(),
        metrics: {
          visibilityRate: visRate,
          shareOfVoice: 0, // Calculated across cohort in leaderboard
          avgPosition: avgPos,
          sentimentScore,
          citationsCount: citCount,
          headToHead: h2h,
        },
      });
    }

    return competitorItems;
  }

  async getCompetitor(
    context: TenantContext,
    projectId: string,
    competitorId: string,
  ): Promise<CompetitorItem> {
    await this.assertProjectAccess(context, projectId);

    const compRes = await this.pool.query<{
      id: string;
      name: string;
      domain: string;
      aliases: string[];
      competitor_type: CompetitorType;
      rationale: string | null;
      discovered_via: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, domain, aliases, coalesce(competitor_type, 'direct') as competitor_type, 
              rationale, discovered_via, created_at, updated_at
       FROM public.competitors
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [competitorId, projectId, context.tenantId],
    );
    if (!compRes.rows.length) {
      throw new ApiError(404, "Competitor not found", "COMPETITOR_NOT_FOUND");
    }

    const items = await this.listCompetitors(context, projectId, { search: compRes.rows[0].name });
    const match = items.find((i) => i.id === competitorId);
    if (!match) {
      throw new ApiError(404, "Competitor not found", "COMPETITOR_NOT_FOUND");
    }
    return match;
  }

  async createCompetitor(
    context: TenantContext,
    projectId: string,
    input: {
      name: string;
      domain: string;
      aliases?: string[];
      competitorType?: CompetitorType;
      rationale?: string | null;
    },
  ): Promise<CompetitorItem> {
    await this.assertProjectAccess(context, projectId);

    // Enforce max 25 competitors plan limit (CMP-FR-001)
    const countRes = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int as count FROM public.competitors WHERE project_id = $1 AND tenant_id = $2`,
      [projectId, context.tenantId],
    );
    if ((countRes.rows[0]?.count || 0) >= 25) {
      throw new ApiError(
        400,
        "Maximum limit of 25 competitors per project reached",
        "MAX_COMPETITORS_REACHED",
      );
    }

    const cleanName = input.name.trim();
    if (!cleanName) {
      throw new ApiError(400, "Competitor name is required", "INVALID_NAME");
    }

    const cleanDomain = this.normalizeHostname(input.domain);
    if (!cleanDomain) {
      throw new ApiError(400, "Valid competitor domain is required", "INVALID_DOMAIN");
    }

    // Check ambiguous name (CMP-FR-008)
    const isAmbiguous = COMMON_AMBIGUOUS_NAMES.has(cleanName.toLowerCase());

    const cleanAliases = (input.aliases || []).map((a) => a.trim()).filter(Boolean);

    const insertRes = await this.pool.query<{ id: string }>(
      `INSERT INTO public.competitors (tenant_id, project_id, name, domain, aliases, competitor_type, rationale, discovered_via)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual')
       RETURNING id`,
      [
        context.tenantId,
        projectId,
        cleanName,
        cleanDomain,
        JSON.stringify(cleanAliases),
        input.competitorType || "direct",
        input.rationale || (isAmbiguous ? "Common name requiring domain disambiguation" : null),
      ],
    );

    return this.getCompetitor(context, projectId, insertRes.rows[0].id);
  }

  async updateCompetitor(
    context: TenantContext,
    projectId: string,
    competitorId: string,
    input: {
      name?: string;
      domain?: string;
      aliases?: string[];
      competitorType?: CompetitorType;
      rationale?: string | null;
    },
  ): Promise<CompetitorItem> {
    await this.assertProjectAccess(context, projectId);

    const existing = await this.getCompetitor(context, projectId, competitorId);

    const cleanName = input.name !== undefined ? input.name.trim() : existing.name;
    const cleanDomain =
      input.domain !== undefined ? this.normalizeHostname(input.domain) : existing.domain;
    const cleanAliases =
      input.aliases !== undefined
        ? input.aliases.map((a) => a.trim()).filter(Boolean)
        : existing.aliases;
    const compType = input.competitorType || existing.competitorType;
    const rationale = input.rationale !== undefined ? input.rationale : existing.rationale;

    await this.pool.query(
      `UPDATE public.competitors 
       SET name = $1, domain = $2, aliases = $3, competitor_type = $4, rationale = $5, updated_at = now()
       WHERE id = $6 AND project_id = $7 AND tenant_id = $8`,
      [
        cleanName,
        cleanDomain,
        JSON.stringify(cleanAliases),
        compType,
        rationale,
        competitorId,
        projectId,
        context.tenantId,
      ],
    );

    return this.getCompetitor(context, projectId, competitorId);
  }

  async deleteCompetitor(
    context: TenantContext,
    projectId: string,
    competitorId: string,
  ): Promise<void> {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `DELETE FROM public.competitors WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [competitorId, projectId, context.tenantId],
    );
    if (!res.rowCount) {
      throw new ApiError(404, "Competitor not found", "COMPETITOR_NOT_FOUND");
    }
  }

  // 2. Leaderboard (CMP-FR-004, CMP-FR-002)
  async getLeaderboard(
    context: TenantContext,
    projectId: string,
    query: CompetitorQuery = {},
  ): Promise<LeaderboardItem[]> {
    const project = await this.assertProjectAccess(context, projectId);
    const brandHost = this.normalizeHostname(project.domain);

    const competitors = await this.listCompetitors(context, projectId);

    // Time window & engine conditions
    const conditions: string[] = [
      "r.project_id = $1",
      "r.tenant_id = $2",
      "r.status IN ('succeeded', 'refused')",
    ];
    const params: unknown[] = [projectId, context.tenantId];

    if (query.days) {
      params.push(new Date(Date.now() - query.days * 86400 * 1000));
      conditions.push(`r.created_at >= $${params.length}`);
    } else if (query.dateFrom) {
      params.push(new Date(query.dateFrom + "T00:00:00.000Z"));
      conditions.push(`r.created_at >= $${params.length}`);
    }
    if (query.dateTo) {
      params.push(new Date(query.dateTo + "T23:59:59.999Z"));
      conditions.push(`r.created_at <= $${params.length}`);
    }
    if (query.engine && query.engine !== "all") {
      params.push(query.engine);
      conditions.push(`coalesce(a.engine, r.request->>'engine') = $${params.length}`);
    }
    this.appendPromptFilters(conditions, params, query, project);

    // 1. Fetch valid runs
    const runsRes = await this.pool.query<{ run_id: string }>(
      `SELECT DISTINCT r.id as run_id 
       FROM public.monitoring_runs r
       JOIN public.answers a ON a.run_id = r.id
       WHERE ${conditions.join(" AND ")}`,
      params,
    );
    const totalRuns = runsRes.rows.length;

    // 2. Compute metrics for Brand
    const brandMentionsRes = await this.pool.query<{
      mention_runs: number;
      avg_pos: number;
      pos_score: number;
      sentiment_score: number;
    }>(
      `SELECT 
         count(DISTINCT a.run_id)::int as mention_runs,
         coalesce(avg(m.position_index), 0)::float as avg_pos,
         coalesce(avg(1.0 / m.position_index), 0)::float as pos_score,
         coalesce(avg(m.sentiment), 0)::float as sentiment_score
       FROM public.mentions m
       JOIN public.answers a ON a.id = m.answer_id
       JOIN public.monitoring_runs r ON r.id = a.run_id
       WHERE ${conditions.join(" AND ")}
         AND (m.entity_type = 'brand' OR lower(m.entity_name) = lower($${params.length + 1}))`,
      [...params, project.brand_name],
    );

    const brandMentionRuns = brandMentionsRes.rows[0]?.mention_runs || 0;
    const brandVis = totalRuns > 0 ? brandMentionRuns / totalRuns : 0;
    const brandAvgPos = Number((brandMentionsRes.rows[0]?.avg_pos || 0).toFixed(1));
    const brandPosScore = Number((brandMentionsRes.rows[0]?.pos_score || 0).toFixed(3));
    const brandSentiment = Number(
      (((brandMentionsRes.rows[0]?.sentiment_score || 0) + 1) / 2).toFixed(2),
    );
    const brandWilson = calculateWilsonInterval(brandMentionRuns, totalRuns);

    // Citations
    const totalCitRes = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int as count 
       FROM public.citations c 
       JOIN public.answers a ON a.id = c.answer_id
       JOIN public.monitoring_runs r ON r.id = a.run_id
       WHERE ${conditions.join(" AND ")}`,
      params,
    );
    const totalCitations = totalCitRes.rows[0]?.count || 0;

    const brandCitRes = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int as count 
       FROM public.citations c 
       JOIN public.answers a ON a.id = c.answer_id
       JOIN public.monitoring_runs r ON r.id = a.run_id
       WHERE ${conditions.join(" AND ")}
         AND (c.domain = $${params.length + 1} OR c.domain LIKE '%' || $${params.length + 1} || '%' OR c.source_type = 'brand')`,
      [...params, brandHost],
    );
    const brandCitShare =
      totalCitations > 0 ? (brandCitRes.rows[0]?.count || 0) / totalCitations : 0;

    const fairShare = Number((1 / (1 + competitors.length)).toFixed(4));

    // Entity metrics map
    const entityVisibilities: Array<{
      entityId: string;
      name: string;
      domain: string;
      isBrand: boolean;
      competitorType?: CompetitorType | null;
      mentionRuns: number;
      visRate: number;
      ciLow: number;
      ciHigh: number;
      posScore: number;
      avgPos: number;
      sentiment: number;
      citShare: number;
      h2hWinRate: number;
    }> = [];

    // Add brand
    entityVisibilities.push({
      entityId: project.id,
      name: project.brand_name,
      domain: brandHost,
      isBrand: true,
      competitorType: null,
      mentionRuns: brandMentionRuns,
      visRate: brandVis,
      ciLow: brandWilson.low,
      ciHigh: brandWilson.high,
      posScore: brandPosScore,
      avgPos: brandAvgPos,
      sentiment: brandSentiment,
      citShare: Number(brandCitShare.toFixed(4)),
      h2hWinRate: 1.0,
    });

    // Compute for each competitor
    for (const comp of competitors) {
      const normHost = this.normalizeHostname(comp.domain);

      const compMentionsRes = await this.pool.query<{
        mention_runs: number;
        avg_pos: number;
        pos_score: number;
        sentiment_score: number;
      }>(
        `SELECT 
           count(DISTINCT a.run_id)::int as mention_runs,
           coalesce(avg(m.position_index), 0)::float as avg_pos,
           coalesce(avg(1.0 / m.position_index), 0)::float as pos_score,
           coalesce(avg(m.sentiment), 0)::float as sentiment_score
         FROM public.mentions m
         JOIN public.answers a ON a.id = m.answer_id
         JOIN public.monitoring_runs r ON r.id = a.run_id
         WHERE ${conditions.join(" AND ")}
           AND (m.entity_name = $${params.length + 1} OR m.entity_type = 'competitor' AND lower(m.entity_name) = lower($${params.length + 1}))`,
        [...params, comp.name],
      );

      const cRuns = compMentionsRes.rows[0]?.mention_runs || 0;
      const cVis = totalRuns > 0 ? cRuns / totalRuns : 0;
      const cWilson = calculateWilsonInterval(cRuns, totalRuns);
      const cAvgPos = Number((compMentionsRes.rows[0]?.avg_pos || 0).toFixed(1));
      const cPosScore = Number((compMentionsRes.rows[0]?.pos_score || 0).toFixed(3));
      const cSentiment = Number(
        (((compMentionsRes.rows[0]?.sentiment_score || 0) + 1) / 2).toFixed(2),
      );

      // Competitor citation share
      const cCitRes = await this.pool.query<{ count: number }>(
        `SELECT count(*)::int as count 
         FROM public.citations c 
         JOIN public.answers a ON a.id = c.answer_id
         JOIN public.monitoring_runs r ON r.id = a.run_id
         WHERE ${conditions.join(" AND ")}
           AND (c.domain = $${params.length + 1} OR c.domain LIKE '%' || $${params.length + 1} || '%' OR c.source_type = 'competitor')`,
        [...params, normHost],
      );
      const cCitShare = totalCitations > 0 ? (cCitRes.rows[0]?.count || 0) / totalCitations : 0;

      // H2H against brand
      const h2h = await this.computeHeadToHeadSummary(context, projectId, comp.name, brandHost);

      entityVisibilities.push({
        entityId: comp.id,
        name: comp.name,
        domain: normHost,
        isBrand: false,
        competitorType: comp.competitorType,
        mentionRuns: cRuns,
        visRate: cVis,
        ciLow: cWilson.low,
        ciHigh: cWilson.high,
        posScore: cPosScore,
        avgPos: cAvgPos,
        sentiment: cSentiment,
        citShare: Number(cCitShare.toFixed(4)),
        h2hWinRate: h2h.winRate,
      });
    }

    // Share of voice = V_e / sum(V_e)
    const sumVis = entityVisibilities.reduce((acc, curr) => acc + curr.visRate, 0);

    // Sort by visibility rate descending
    entityVisibilities.sort((a, b) => b.visRate - a.visRate);

    return entityVisibilities.map((item, idx) => {
      const sov = sumVis > 0 ? Number((item.visRate / sumVis).toFixed(4)) : 0;
      return {
        rank: idx + 1,
        rankDelta: 0,
        entityId: item.entityId,
        name: item.name,
        domain: item.domain,
        isBrand: item.isBrand,
        competitorType: item.competitorType,
        visibilityRate: Number(item.visRate.toFixed(4)),
        ciLow: item.ciLow,
        ciHigh: item.ciHigh,
        shareOfVoice: sov,
        fairShare,
        positionScore: item.posScore,
        avgPosition: item.avgPos,
        sentimentScore: item.sentiment,
        citationShare: item.citShare,
        headToHeadWinRate: item.h2hWinRate,
      };
    });
  }

  // 3. Head-to-Head Comparison View (CMP-FR-003)
  async getHeadToHead(
    context: TenantContext,
    projectId: string,
    competitorId: string,
    query: CompetitorQuery = {},
  ): Promise<HeadToHeadResponse> {
    const project = await this.assertProjectAccess(context, projectId);

    const comp = await this.getCompetitor(context, projectId, competitorId);

    // Fetch prompts
    const promptRes = await this.pool.query<{
      id: string;
      body: string;
      priority: number;
    }>(
      `SELECT id, body, 1::int as priority 
       FROM public.monitoring_prompts 
       WHERE project_id = $1 AND tenant_id = $2 AND active = true
       ORDER BY created_at ASC`,
      [projectId, context.tenantId],
    );

    const conditions: string[] = [
      "r.project_id = $1",
      "r.tenant_id = $2",
      "r.status IN ('succeeded', 'refused')",
    ];
    const params: unknown[] = [projectId, context.tenantId];

    if (query.days) {
      params.push(new Date(Date.now() - query.days * 86400 * 1000));
      conditions.push(`r.created_at >= $${params.length}`);
    } else if (query.dateFrom) {
      params.push(new Date(query.dateFrom + "T00:00:00.000Z"));
      conditions.push(`r.created_at >= $${params.length}`);
    }
    if (query.dateTo) {
      params.push(new Date(query.dateTo + "T23:59:59.999Z"));
      conditions.push(`r.created_at <= $${params.length}`);
    }
    if (query.engine && query.engine !== "all") {
      params.push(query.engine);
      conditions.push(`coalesce(a.engine, r.request->>'engine') = $${params.length}`);
    }
    this.appendPromptFilters(conditions, params, query, project);

    let wins = 0;
    let losses = 0;
    let ties = 0;
    const promptResults: HeadToHeadPromptItem[] = [];

    let totalBrandRuns = 0;
    let totalCompRuns = 0;
    let totalEvaluatedRuns = 0;

    for (const p of promptRes.rows) {
      // Find runs for this prompt
      const runsForPrompt = await this.pool.query<{
        run_id: string;
        engine: string;
        brand_rank: number | null;
        comp_rank: number | null;
      }>(
        `SELECT 
           r.id as run_id,
           coalesce(a.engine, r.request->>'engine') as engine,
           (
             SELECT min(m.position_index)::int 
             FROM public.mentions m 
             WHERE m.answer_id = a.id AND (m.entity_type = 'brand' OR lower(m.entity_name) = lower($${params.length + 2}))
           ) as brand_rank,
           (
             SELECT min(m.position_index)::int 
             FROM public.mentions m 
             WHERE m.answer_id = a.id AND (m.entity_name = $${params.length + 3} OR m.entity_type = 'competitor' AND lower(m.entity_name) = lower($${params.length + 3}))
           ) as comp_rank
         FROM public.monitoring_runs r
         JOIN public.answers a ON a.run_id = r.id
         WHERE ${conditions.join(" AND ")}
           AND coalesce(a.prompt_id, (r.request->>'promptId')::uuid) = $${params.length + 1}`,
        [...params, p.id, project.brand_name, comp.name],
      );

      const runs = runsForPrompt.rows;
      if (!runs.length) continue;

      totalEvaluatedRuns += runs.length;

      let promptBrandMentions = 0;
      let promptCompMentions = 0;
      const engines = Array.from(new Set(runs.map((r) => r.engine)));

      let pWins = 0;
      let pLosses = 0;
      let bestBrandRank: number | null = null;
      let bestCompRank: number | null = null;

      for (const r of runs) {
        if (r.brand_rank !== null) {
          promptBrandMentions++;
          totalBrandRuns++;
          if (bestBrandRank === null || r.brand_rank < bestBrandRank) bestBrandRank = r.brand_rank;
        }
        if (r.comp_rank !== null) {
          promptCompMentions++;
          totalCompRuns++;
          if (bestCompRank === null || r.comp_rank < bestCompRank) bestCompRank = r.comp_rank;
        }

        if (r.brand_rank !== null && r.comp_rank === null) {
          pWins++;
        } else if (r.brand_rank === null && r.comp_rank !== null) {
          pLosses++;
        } else if (r.brand_rank !== null && r.comp_rank !== null) {
          if (r.brand_rank < r.comp_rank) {
            pWins++;
          } else if (r.brand_rank > r.comp_rank) {
            pLosses++;
          }
        }
      }

      // Prompt overall outcome
      let outcome: HeadToHeadOutcome;
      if (pWins > pLosses) {
        outcome = "win";
        wins++;
      } else if (pLosses > pWins) {
        outcome = "loss";
        losses++;
      } else {
        outcome = "tie";
        ties++;
      }

      promptResults.push({
        promptId: p.id,
        promptText: p.body,
        priority: p.priority,
        brandRank: bestBrandRank,
        competitorRank: bestCompRank,
        brandVis: Number((promptBrandMentions / runs.length).toFixed(3)),
        competitorVis: Number((promptCompMentions / runs.length).toFixed(3)),
        outcome,
        engines,
      });
    }

    const totalPrompts = wins + losses + ties;
    const winRate = totalPrompts > 0 ? Number(((wins / totalPrompts) * 100).toFixed(1)) : 0;
    const brandVisRate =
      totalEvaluatedRuns > 0 ? Number((totalBrandRuns / totalEvaluatedRuns).toFixed(3)) : 0;
    const compVisRate =
      totalEvaluatedRuns > 0 ? Number((totalCompRuns / totalEvaluatedRuns).toFixed(3)) : 0;

    return {
      competitor: {
        id: comp.id,
        name: comp.name,
        domain: comp.domain,
        competitorType: comp.competitorType,
      },
      summary: {
        wins,
        losses,
        ties,
        totalPrompts,
        winRate,
        brandVisibilityRate: brandVisRate,
        competitorVisibilityRate: compVisRate,
      },
      prompts: promptResults,
    };
  }

  // 4. Competitive Gap Score & Visibility Gaps (CMP-FR-005, CMP-FR-012)
  async getCompetitiveGaps(
    context: TenantContext,
    projectId: string,
    query: CompetitorQuery = {},
  ): Promise<CompetitiveGapItem[]> {
    const project = await this.assertProjectAccess(context, projectId);
    const competitors = await this.listCompetitors(context, projectId);

    if (!competitors.length) return [];

    const promptRes = await this.pool.query<{
      id: string;
      body: string;
      priority: number;
    }>(
      `SELECT id, body, 1::int as priority 
       FROM public.monitoring_prompts 
       WHERE project_id = $1 AND tenant_id = $2 AND active = true
       ORDER BY created_at ASC`,
      [projectId, context.tenantId],
    );

    const conditions: string[] = [
      "r.project_id = $1",
      "r.tenant_id = $2",
      "r.status IN ('succeeded', 'refused')",
    ];
    const params: unknown[] = [projectId, context.tenantId];

    if (query.days) {
      params.push(new Date(Date.now() - query.days * 86400 * 1000));
      conditions.push(`r.created_at >= $${params.length}`);
    } else if (query.dateFrom) {
      params.push(new Date(query.dateFrom + "T00:00:00.000Z"));
      conditions.push(`r.created_at >= $${params.length}`);
    }
    if (query.dateTo) {
      params.push(new Date(query.dateTo + "T23:59:59.999Z"));
      conditions.push(`r.created_at <= $${params.length}`);
    }
    if (query.engine && query.engine !== "all") {
      params.push(query.engine);
      conditions.push(`coalesce(a.engine, r.request->>'engine') = $${params.length}`);
    }
    this.appendPromptFilters(conditions, params, query, project);

    const gaps: CompetitiveGapItem[] = [];

    for (const p of promptRes.rows) {
      const runsRes = await this.pool.query<{
        run_id: string;
        engine: string;
        brand_mentioned: boolean;
      }>(
        `SELECT 
           r.id as run_id,
           coalesce(a.engine, r.request->>'engine') as engine,
           EXISTS (
             SELECT 1 FROM public.mentions m 
             WHERE m.answer_id = a.id AND (m.entity_type = 'brand' OR lower(m.entity_name) = lower($${params.length + 2}))
           ) as brand_mentioned
         FROM public.monitoring_runs r
         JOIN public.answers a ON a.run_id = r.id
         WHERE ${conditions.join(" AND ")}
           AND coalesce(a.prompt_id, (r.request->>'promptId')::uuid) = $${params.length + 1}`,
        [...params, p.id, project.brand_name],
      );

      const runs = runsRes.rows;
      if (!runs.length) continue;

      const brandMentions = runs.filter((r) => r.brand_mentioned).length;
      const brandVis = brandMentions / runs.length;
      const promptEngines = Array.from(new Set(runs.map((r) => r.engine)));

      for (const comp of competitors) {
        const compMentionsRes = await this.pool.query<{ count: number }>(
          `SELECT count(DISTINCT a.run_id)::int as count
           FROM public.mentions m
           JOIN public.answers a ON a.id = m.answer_id
           JOIN public.monitoring_runs r ON r.id = a.run_id
           WHERE ${conditions.join(" AND ")}
             AND coalesce(a.prompt_id, (r.request->>'promptId')::uuid) = $${params.length + 1}
             AND (m.entity_name = $${params.length + 2} OR m.entity_type = 'competitor' AND lower(m.entity_name) = lower($${params.length + 2}))`,
          [...params, p.id, comp.name],
        );

        const compMentions = compMentionsRes.rows[0]?.count || 0;
        const compVis = compMentions / runs.length;

        // Gap(p, c) = w_p * max(0, V_c(p) - V_brand(p))
        // PromptWeight = (priority / 5) * (demand_index / 100), demand defaults to 50
        const demandIndex = 50;
        const promptWeight = (p.priority / 5.0) * (demandIndex / 100.0);
        const rawGap = Math.max(0, compVis - brandVis);

        if (rawGap > 0) {
          const gapScore = Number((promptWeight * rawGap * 100).toFixed(2));

          const reasons: string[] = [];
          if (brandVis === 0) {
            reasons.push("Brand completely missing in answers for this prompt");
          } else {
            reasons.push(
              `Brand visibility is ${(brandVis * 100).toFixed(0)}% vs competitor ${(compVis * 100).toFixed(0)}%`,
            );
          }
          if (p.priority >= 4) {
            reasons.push("High priority buyer prompt");
          }

          gaps.push({
            promptId: p.id,
            promptText: p.body,
            priority: p.priority,
            competitorId: comp.id,
            competitorName: comp.name,
            competitorVis: Number(compVis.toFixed(3)),
            brandVis: Number(brandVis.toFixed(3)),
            gapScore,
            promptWeight: Number(promptWeight.toFixed(4)),
            demandIndex,
            reasons,
            engines: promptEngines,
          });

          // Cache gap score into competitive_gaps table
          await this.pool.query(
            `INSERT INTO public.competitive_gaps 
             (tenant_id, project_id, competitor_id, prompt_id, engine, competitor_vis, brand_vis, gap_score, prompt_weight, demand_index, priority, reasons, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
             ON CONFLICT (project_id, competitor_id, prompt_id, engine)
             DO UPDATE SET 
               competitor_vis = EXCLUDED.competitor_vis,
               brand_vis = EXCLUDED.brand_vis,
               gap_score = EXCLUDED.gap_score,
               prompt_weight = EXCLUDED.prompt_weight,
               reasons = EXCLUDED.reasons,
               updated_at = now()`,
            [
              context.tenantId,
              projectId,
              comp.id,
              p.id,
              query.engine || "all",
              compVis,
              brandVis,
              gapScore,
              promptWeight,
              demandIndex,
              p.priority,
              JSON.stringify(reasons),
            ],
          );
        }
      }
    }

    // Rank gaps by gapScore descending
    gaps.sort((a, b) => b.gapScore - a.gapScore);
    return gaps;
  }

  // 5. Competitor Auto-Discovery (CMP-FR-010, CMP-FR-016, Feature CMP-F1)
  async runCompetitorAutoDiscovery(
    context: TenantContext,
    projectId: string,
  ): Promise<CompetitorCandidateItem[]> {
    const project = await this.assertProjectAccess(context, projectId);
    const brandName = project.brand_name.toLowerCase();

    // Fetch existing competitors
    const compRes = await this.pool.query<{ name: string; domain: string }>(
      `SELECT name, domain FROM public.competitors WHERE project_id = $1 AND tenant_id = $2`,
      [projectId, context.tenantId],
    );
    const existingNames = new Set<string>([brandName]);
    for (const c of compRes.rows) {
      existingNames.add(c.name.toLowerCase());
      existingNames.add(this.normalizeHostname(c.domain));
    }

    // Total runs in scope
    const runsRes = await this.pool.query<{ count: number }>(
      `SELECT count(DISTINCT r.id)::int as count 
       FROM public.monitoring_runs r
       JOIN public.answers a ON a.run_id = r.id
       WHERE r.project_id = $1 AND r.tenant_id = $2 AND r.status IN ('succeeded', 'refused')`,
      [projectId, context.tenantId],
    );
    const totalRuns = runsRes.rows[0]?.count || 0;
    if (totalRuns === 0) return [];

    // Scan mentions for entities not in existing competitors
    const mentionsRes = await this.pool.query<{
      entity_name: string;
      entity_type: string;
      mention_runs: number;
      co_occurrence_runs: number;
      engines: string[];
      sample_answers: string[];
    }>(
      `SELECT 
         m.entity_name,
         m.entity_type,
         count(DISTINCT a.run_id)::int as mention_runs,
         count(DISTINCT CASE WHEN EXISTS (
           SELECT 1 FROM public.mentions m2 
           WHERE m2.answer_id = a.id AND (m2.entity_type = 'brand' OR lower(m2.entity_name) = lower($3))
         ) THEN a.run_id END)::int as co_occurrence_runs,
         array_agg(DISTINCT coalesce(a.engine, r.request->>'engine')) as engines,
         (array_agg(a.id))[1:5] as sample_answers
       FROM public.mentions m
       JOIN public.answers a ON a.id = m.answer_id
       JOIN public.monitoring_runs r ON r.id = a.run_id
       WHERE r.project_id = $1 AND r.tenant_id = $2
         AND r.status IN ('succeeded', 'refused')
       GROUP BY m.entity_name, m.entity_type
       HAVING count(DISTINCT a.run_id)::float / $4 >= 0.10`,
      [projectId, context.tenantId, project.brand_name, totalRuns],
    );

    const candidates: CompetitorCandidateItem[] = [];

    for (const row of mentionsRes.rows) {
      const cleanName = row.entity_name.trim();
      const lower = cleanName.toLowerCase();

      // Check if already known brand or competitor
      if (existingNames.has(lower)) continue;

      // Check 90-day rejection cooldown (CMP-FR-016)
      const rejectedCheck = await this.pool.query<{ rejected_at: Date }>(
        `SELECT rejected_at FROM public.competitor_candidates 
         WHERE project_id = $1 AND lower(name) = lower($2) AND status = 'rejected'`,
        [projectId, cleanName],
      );
      if (rejectedCheck.rows.length && rejectedCheck.rows[0].rejected_at) {
        const diffMs = Date.now() - rejectedCheck.rows[0].rejected_at.getTime();
        const ninetyDaysMs = 90 * 86400 * 1000;
        if (diffMs < ninetyDaysMs) {
          // Still in 90-day cooldown period
          continue;
        }
      }

      const frequency = Number((row.mention_runs / totalRuns).toFixed(4));

      // Classify candidate entity type (CMP-FR-010)
      let entityType: CandidateEntityType = "competitor";
      if (
        lower.includes("amazon") ||
        lower.includes("walmart") ||
        lower.includes("ebay") ||
        lower.includes("g2")
      ) {
        entityType = "marketplace";
      } else if (
        lower.includes("times") ||
        lower.includes("forbes") ||
        lower.includes("radar") ||
        lower.includes("tech")
      ) {
        entityType = "publisher";
      }

      // Upsert candidate record
      const upsertRes = await this.pool.query<{
        id: string;
        name: string;
        domain: string | null;
        mention_count: number;
        mention_frequency: string;
        co_occurrence_count: number;
        engines: string[];
        sample_answer_ids: string[];
        entity_type: CandidateEntityType;
        status: CandidateStatus;
        rejected_at: Date | null;
        snoozed_until: Date | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO public.competitor_candidates 
         (tenant_id, project_id, name, domain, mention_count, mention_frequency, co_occurrence_count, engines, sample_answer_ids, entity_type, status, updated_at)
         VALUES ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, 'suggested', now())
         ON CONFLICT (project_id, lower(name))
         DO UPDATE SET 
           mention_count = EXCLUDED.mention_count,
           mention_frequency = EXCLUDED.mention_frequency,
           co_occurrence_count = EXCLUDED.co_occurrence_count,
           engines = EXCLUDED.engines,
           sample_answer_ids = EXCLUDED.sample_answer_ids,
           updated_at = now()
         RETURNING *`,
        [
          context.tenantId,
          projectId,
          cleanName,
          row.mention_runs,
          frequency,
          row.co_occurrence_runs,
          JSON.stringify(row.engines || []),
          JSON.stringify(row.sample_answers || []),
          entityType,
        ],
      );

      const r = upsertRes.rows[0];
      candidates.push({
        id: r.id,
        name: r.name,
        domain: r.domain,
        mentionCount: r.mention_count,
        mentionFrequency: Number(r.mention_frequency),
        coOccurrenceCount: r.co_occurrence_count,
        engines: r.engines || [],
        sampleAnswerIds: r.sample_answer_ids || [],
        entityType: r.entity_type,
        status: r.status,
        rejectedAt: r.rejected_at ? r.rejected_at.toISOString() : null,
        snoozedUntil: r.snoozed_until ? r.snoozed_until.toISOString() : null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      });
    }

    return candidates;
  }

  async listCandidates(
    context: TenantContext,
    projectId: string,
    status?: CandidateStatus,
  ): Promise<CompetitorCandidateItem[]> {
    await this.assertProjectAccess(context, projectId);

    const conditions: string[] = ["project_id = $1", "tenant_id = $2"];
    const params: unknown[] = [projectId, context.tenantId];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const res = await this.pool.query<{
      id: string;
      name: string;
      domain: string | null;
      mention_count: number;
      mention_frequency: string;
      co_occurrence_count: number;
      engines: string[];
      sample_answer_ids: string[];
      entity_type: CandidateEntityType;
      status: CandidateStatus;
      rejected_at: Date | null;
      snoozed_until: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM public.competitor_candidates 
       WHERE ${conditions.join(" AND ")}
       ORDER BY mention_frequency DESC, created_at DESC`,
      params,
    );

    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      mentionCount: r.mention_count,
      mentionFrequency: Number(r.mention_frequency),
      coOccurrenceCount: r.co_occurrence_count,
      engines: r.engines || [],
      sampleAnswerIds: r.sample_answer_ids || [],
      entityType: r.entity_type,
      status: r.status,
      rejectedAt: r.rejected_at ? r.rejected_at.toISOString() : null,
      snoozedUntil: r.snoozed_until ? r.snoozed_until.toISOString() : null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async acceptCandidate(
    context: TenantContext,
    projectId: string,
    candidateId: string,
  ): Promise<CompetitorItem> {
    await this.assertProjectAccess(context, projectId);

    const candRes = await this.pool.query<{ id: string; name: string; domain: string | null }>(
      `SELECT id, name, domain FROM public.competitor_candidates 
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [candidateId, projectId, context.tenantId],
    );
    if (!candRes.rows.length) {
      throw new ApiError(404, "Candidate not found", "CANDIDATE_NOT_FOUND");
    }

    const candidate = candRes.rows[0];

    // Create competitor (this checks max 25 limit)
    const newComp = await this.createCompetitor(context, projectId, {
      name: candidate.name,
      domain: candidate.domain || `${candidate.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
      competitorType: "direct",
      rationale: "Auto-discovered from answers",
    });

    // Mark candidate as accepted
    await this.pool.query(
      `UPDATE public.competitor_candidates SET status = 'accepted', updated_at = now() WHERE id = $1`,
      [candidateId],
    );

    return newComp;
  }

  async rejectCandidate(
    context: TenantContext,
    projectId: string,
    candidateId: string,
  ): Promise<void> {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `UPDATE public.competitor_candidates 
       SET status = 'rejected', rejected_at = now(), updated_at = now() 
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [candidateId, projectId, context.tenantId],
    );
    if (!res.rowCount) {
      throw new ApiError(404, "Candidate not found", "CANDIDATE_NOT_FOUND");
    }
  }

  async snoozeCandidate(
    context: TenantContext,
    projectId: string,
    candidateId: string,
  ): Promise<void> {
    await this.assertProjectAccess(context, projectId);
    const res = await this.pool.query(
      `UPDATE public.competitor_candidates 
       SET status = 'snoozed', snoozed_until = now() + interval '30 days', updated_at = now() 
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [candidateId, projectId, context.tenantId],
    );
    if (!res.rowCount) {
      throw new ApiError(404, "Candidate not found", "CANDIDATE_NOT_FOUND");
    }
  }

  // 6. CSV Export (RFC 4180)
  async exportCsv(
    context: TenantContext,
    projectId: string,
    type: "leaderboard" | "head_to_head" | "gaps",
    query: CompetitorQuery = {},
    competitorId?: string,
  ): Promise<string> {
    if (type === "leaderboard") {
      const items = await this.getLeaderboard(context, projectId, query);
      const rows = [
        [
          "Rank",
          "Entity",
          "Domain",
          "Type",
          "Visibility Rate",
          "Share of Voice",
          "Avg Position",
          "Sentiment",
          "Citation Share",
          "H2H Win Rate",
        ],
        ...items.map((i) => [
          i.rank,
          `"${i.name.replaceAll('"', '""')}"`,
          `"${i.domain.replaceAll('"', '""')}"`,
          i.isBrand ? "Brand" : i.competitorType || "Competitor",
          `${(i.visibilityRate * 100).toFixed(1)}%`,
          `${(i.shareOfVoice * 100).toFixed(1)}%`,
          i.avgPosition,
          i.sentimentScore,
          `${(i.citationShare * 100).toFixed(1)}%`,
          `${(i.headToHeadWinRate * 100).toFixed(1)}%`,
        ]),
      ];
      return rows.map((r) => r.join(",")).join("\r\n");
    }

    if (type === "head_to_head" && competitorId) {
      const h2h = await this.getHeadToHead(context, projectId, competitorId, query);
      const rows = [
        [
          "Prompt",
          "Priority",
          "Brand Rank",
          "Competitor Rank",
          "Brand Vis",
          "Competitor Vis",
          "Outcome",
          "Engines",
        ],
        ...h2h.prompts.map((p) => [
          `"${p.promptText.replaceAll('"', '""')}"`,
          p.priority,
          p.brandRank ?? "Not mentioned",
          p.competitorRank ?? "Not mentioned",
          `${(p.brandVis * 100).toFixed(1)}%`,
          `${(p.competitorVis * 100).toFixed(1)}%`,
          p.outcome.toUpperCase(),
          `"${p.engines.join("; ")}"`,
        ]),
      ];
      return rows.map((r) => r.join(",")).join("\r\n");
    }

    // Default: gaps
    const gaps = await this.getCompetitiveGaps(context, projectId, query);
    const rows = [
      [
        "Prompt",
        "Priority",
        "Competitor",
        "Competitor Vis",
        "Brand Vis",
        "Gap Score",
        "Reasons",
        "Engines",
      ],
      ...gaps.map((g) => [
        `"${g.promptText.replaceAll('"', '""')}"`,
        g.priority,
        `"${g.competitorName.replaceAll('"', '""')}"`,
        `${(g.competitorVis * 100).toFixed(1)}%`,
        `${(g.brandVis * 100).toFixed(1)}%`,
        g.gapScore,
        `"${g.reasons.join("; ").replaceAll('"', '""')}"`,
        `"${g.engines.join("; ")}"`,
      ]),
    ];
    return rows.map((r) => r.join(",")).join("\r\n");
  }

  private async computeHeadToHeadSummary(
    context: TenantContext,
    projectId: string,
    competitorName: string,
    _brandHost: string,
  ): Promise<{ wins: number; losses: number; ties: number; winRate: number }> {
    const project = await this.assertProjectAccess(context, projectId);

    const res = await this.pool.query<{
      brand_rank: number | null;
      comp_rank: number | null;
    }>(
      `SELECT 
         (
           SELECT min(m.position_index)::int 
           FROM public.mentions m 
           WHERE m.answer_id = a.id AND (m.entity_type = 'brand' OR lower(m.entity_name) = lower($3))
         ) as brand_rank,
         (
           SELECT min(m.position_index)::int 
           FROM public.mentions m 
           WHERE m.answer_id = a.id AND (m.entity_name = $4 OR m.entity_type = 'competitor' AND lower(m.entity_name) = lower($4))
         ) as comp_rank
       FROM public.monitoring_runs r
       JOIN public.answers a ON a.run_id = r.id
       WHERE r.project_id = $1 AND r.tenant_id = $2
         AND r.status IN ('succeeded', 'refused')`,
      [projectId, context.tenantId, project.brand_name, competitorName],
    );

    let wins = 0;
    let losses = 0;
    let ties = 0;

    for (const r of res.rows) {
      if (r.brand_rank !== null && r.comp_rank === null) {
        wins++;
      } else if (r.brand_rank === null && r.comp_rank !== null) {
        losses++;
      } else if (r.brand_rank !== null && r.comp_rank !== null) {
        if (r.brand_rank < r.comp_rank) wins++;
        else if (r.brand_rank > r.comp_rank) losses++;
        else ties++;
      } else {
        ties++;
      }
    }

    const total = wins + losses + ties;
    const winRate = total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0;
    return { wins, losses, ties, winRate };
  }
}
