import type { Pool } from "pg";
import { ApiError } from "../../utils/ApiError.js";
import { calculateWilsonInterval, evaluateConfidence, type ConfidenceTier } from "./statistics.js";
import type { SourceType } from "../answer/citation-extractor.js";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role?: string;
}

export interface CitationQuery {
  dateFrom?: string;
  dateTo?: string;
  days?: number;
  engine?: string;
  sourceType?: string;
}

export interface DomainCitationItem {
  domain: string;
  sourceType: SourceType;
  citationCount: number;
  citationShare: number;
  ciLow?: number;
  ciHigh?: number;
  distinctPagesCount: number;
  engines: string[];
  trendStatus: "new" | "lost" | "retained";
  delta: number;
  isAllowed: boolean;
  isDenied: boolean;
  citesBrand: boolean;
  citesCompetitors: string[];
}

export interface PageCitationItem {
  url: string;
  normalizedUrl: string;
  domain: string;
  sourceType: SourceType;
  citationCount: number;
  engines: string[];
  promptsCount: number;
  isBrandPage: boolean;
  competitorsCited: string[];
}

export interface CitationGapItem {
  domain: string;
  pageUrl: string | null;
  sourceType: SourceType;
  gapRunsCount: number;
  opportunityScore: number;
  competitorNames: string[];
  prompts: Array<{
    promptId: string;
    text: string;
    priority: number;
  }>;
  suggestedAction: string;
}

export interface BrokenCitationItem {
  id: string;
  citationId: string | null;
  url: string;
  normalizedUrl: string;
  domain: string;
  statusCode: number;
  redirectUrl: string | null;
  errorMessage: string | null;
  taskStatus: "open" | "resolved" | "ignored";
  checkedAt: string;
  createdAt: string;
}

export interface CitationOverviewResponse {
  project: {
    id: string;
    brandName: string;
    domain: string;
  };
  timeWindow: {
    current: { from: string; to: string; days: number };
    previous: { from: string; to: string; days: number };
  };
  summary: {
    totalCitationsCount: number;
    uniqueDomainsCount: number;
    uniquePagesCount: number;
    brandCitationRate: {
      value: number;
      label: "Observed";
      n: number;
      ciLow?: number;
      ciHigh?: number;
      confidenceTier: ConfidenceTier;
      confidenceLabel: string;
    };
    sourceTypeDistribution: Record<string, { count: number; share: number }>;
    gapsCount: number;
    brokenCitationsCount: number;
  };
  topDomains: DomainCitationItem[];
  brandPages: PageCitationItem[];
}

export interface SourceDomainInput {
  domain: string;
  sourceType?: SourceType;
  isAllowed?: boolean;
  isDenied?: boolean;
  notes?: string;
}

export class CitationService {
  constructor(
    private readonly pool: Pool,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

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

  private resolveDateWindows(query: CitationQuery): {
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

  private normalizeHostname(domainOrUrl: string): string {
    let clean = domainOrUrl.trim().toLowerCase();
    clean = clean.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "");
    const slashIdx = clean.indexOf("/");
    if (slashIdx !== -1) clean = clean.slice(0, slashIdx);
    const colonIdx = clean.indexOf(":");
    if (colonIdx !== -1) clean = clean.slice(0, colonIdx);
    return clean;
  }

  // 1. Citation Overview (CIT-FR-001 to CIT-FR-004)
  async getCitationOverview(
    context: TenantContext,
    projectId: string,
    query: CitationQuery = {},
  ): Promise<CitationOverviewResponse> {
    const project = await this.assertProjectAccess(context, projectId);
    const windows = this.resolveDateWindows(query);
    const brandHost = this.normalizeHostname(project.domain);

    // Fetch domain citations for current and previous windows
    const [domainsCurrent, domainsPrevious, brandPages, gaps, brokenRes] = await Promise.all([
      this.listDomainCitations(context, projectId, {
        dateFrom: windows.current.fromStr,
        dateTo: windows.current.toStr,
        engine: query.engine,
        sourceType: query.sourceType,
      }),
      this.listDomainCitations(context, projectId, {
        dateFrom: windows.previous.fromStr,
        dateTo: windows.previous.toStr,
        engine: query.engine,
        sourceType: query.sourceType,
      }),
      this.listPageCitations(context, projectId, {
        dateFrom: windows.current.fromStr,
        dateTo: windows.current.toStr,
        engine: query.engine,
        onlyBrandPages: true,
      }),
      this.getCitationGaps(context, projectId, {
        dateFrom: windows.current.fromStr,
        dateTo: windows.current.toStr,
        engine: query.engine,
      }),
      this.pool.query<{ count: number }>(
        `SELECT count(*)::int as count FROM public.broken_citations 
         WHERE project_id = $1 AND tenant_id = $2 AND task_status = 'open'`,
        [projectId, context.tenantId],
      ),
    ]);

    const totalCitationsCount = domainsCurrent.reduce((acc, d) => acc + d.citationCount, 0);
    const uniqueDomainsCount = domainsCurrent.length;

    // Distinct pages count
    const pagesCountRes = await this.pool.query<{ count: number }>(
      `SELECT count(DISTINCT c.normalized_url)::int as count 
       FROM public.citations c
       JOIN public.answers a ON a.id = c.answer_id
       JOIN public.monitoring_runs r ON r.id = a.run_id
       WHERE c.project_id = $1 AND c.tenant_id = $2
         AND r.status IN ('succeeded', 'refused')
         AND r.created_at >= $3 AND r.created_at <= $4`,
      [projectId, context.tenantId, windows.current.from, windows.current.to],
    );
    const uniquePagesCount = pagesCountRes.rows[0]?.count ?? 0;

    // Brand citation rate calculation (valid runs citing brand / valid runs with at least 1 citation)
    const runCitationStatsRes = await this.pool.query<{
      runs_with_citations: number;
      brand_cited_runs: number;
    }>(
      `SELECT 
         count(DISTINCT r.id) FILTER (WHERE a.has_citations = true OR EXISTS (SELECT 1 FROM citations c WHERE c.answer_id = a.id))::int as runs_with_citations,
         count(DISTINCT r.id) FILTER (WHERE EXISTS (
           SELECT 1 FROM citations c 
           WHERE c.answer_id = a.id 
             AND (c.domain = $3 OR c.domain LIKE '%' || $3 || '%' OR c.source_type = 'brand')
         ))::int as brand_cited_runs
       FROM public.monitoring_runs r
       JOIN public.answers a ON a.run_id = r.id
       WHERE r.project_id = $1 AND r.tenant_id = $2
         AND r.status IN ('succeeded', 'refused')
         AND r.created_at >= $4 AND r.created_at <= $5`,
      [projectId, context.tenantId, brandHost, windows.current.from, windows.current.to],
    );

    const runsWithCitations = runCitationStatsRes.rows[0]?.runs_with_citations ?? 0;
    const brandCitedRuns = runCitationStatsRes.rows[0]?.brand_cited_runs ?? 0;
    const brandCitationRateVal =
      runsWithCitations > 0 ? Number((brandCitedRuns / runsWithCitations).toFixed(4)) : 0;
    const brandWilson = calculateWilsonInterval(brandCitedRuns, runsWithCitations);
    const brandConf = evaluateConfidence(runsWithCitations);

    // Source type distribution (CIT-FR-002)
    const distribution: Record<string, { count: number; share: number }> = {};
    for (const d of domainsCurrent) {
      const type = d.sourceType || "other";
      if (!distribution[type]) {
        distribution[type] = { count: 0, share: 0 };
      }
      distribution[type].count += d.citationCount;
    }
    for (const type of Object.keys(distribution)) {
      distribution[type].share =
        totalCitationsCount > 0
          ? Number((distribution[type].count / totalCitationsCount).toFixed(4))
          : 0;
    }

    // Attach previous delta and trend status to domainsCurrent (CIT-FR-006)
    const prevMap = new Map<string, number>();
    for (const p of domainsPrevious) {
      prevMap.set(p.domain, p.citationCount);
    }

    for (const d of domainsCurrent) {
      const prevCount = prevMap.get(d.domain) ?? 0;
      d.delta = d.citationCount - prevCount;
      if (prevCount === 0) {
        d.trendStatus = "new";
      } else {
        d.trendStatus = "retained";
      }
    }

    return {
      project: {
        id: project.id,
        brandName: project.brand_name,
        domain: project.domain,
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
      summary: {
        totalCitationsCount,
        uniqueDomainsCount,
        uniquePagesCount,
        brandCitationRate: {
          value: brandCitationRateVal,
          label: "Observed",
          n: runsWithCitations,
          ciLow: brandWilson.low,
          ciHigh: brandWilson.high,
          confidenceTier: brandConf.tier,
          confidenceLabel: brandConf.label,
        },
        sourceTypeDistribution: distribution,
        gapsCount: gaps.length,
        brokenCitationsCount: brokenRes.rows[0]?.count ?? 0,
      },
      topDomains: domainsCurrent.slice(0, 50),
      brandPages: brandPages.slice(0, 20),
    };
  }

  // 2. Domain Citations Aggregation & Trend Tracking (CIT-FR-003, CIT-FR-006, CIT-FR-010)
  async listDomainCitations(
    context: TenantContext,
    projectId: string,
    query: {
      days?: number;
      dateFrom?: string;
      dateTo?: string;
      engine?: string;
      sourceType?: string;
      search?: string;
    } = {},
  ): Promise<DomainCitationItem[]> {
    const project = await this.assertProjectAccess(context, projectId);
    const brandHost = this.normalizeHostname(project.domain);

    // Fetch competitors for competitor attribution
    const compRes = await this.pool.query<{ id: string; name: string; domain: string }>(
      `SELECT id, name, domain FROM public.competitors WHERE project_id = $1 AND tenant_id = $2`,
      [projectId, context.tenantId],
    );
    const competitors = compRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: this.normalizeHostname(r.domain),
    }));

    const conditions: string[] = [
      "c.project_id = $1",
      "c.tenant_id = $2",
      "r.status IN ('succeeded', 'refused')",
    ];
    const params: unknown[] = [projectId, context.tenantId, brandHost];

    if (query.dateFrom) {
      params.push(new Date(query.dateFrom + "T00:00:00.000Z"));
      conditions.push(`r.created_at >= $${params.length}`);
    } else if (query.days) {
      params.push(new Date(Date.now() - query.days * 86400 * 1000));
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
    if (query.sourceType && query.sourceType !== "all") {
      params.push(query.sourceType);
      conditions.push(`coalesce(sd.source_type, c.source_type) = $${params.length}`);
    }
    if (query.search && query.search.trim()) {
      params.push(`%${query.search.trim().toLowerCase()}%`);
      conditions.push(`lower(c.domain) LIKE $${params.length}`);
    }

    const queryStr = `
      SELECT 
        c.domain,
        coalesce(sd.source_type, c.source_type) as source_type,
        count(*)::int as citation_count,
        count(DISTINCT c.normalized_url)::int as distinct_pages_count,
        array_agg(DISTINCT coalesce(a.engine, r.request->>'engine')) as engines,
        coalesce(sd.is_allowed, true) as is_allowed,
        coalesce(sd.is_denied, false) as is_denied,
        bool_or(
          c.domain = $3 
          OR c.domain LIKE '%' || $3 || '%' 
          OR c.source_type = 'brand'
        ) as cites_brand
      FROM public.citations c
      JOIN public.answers a ON a.id = c.answer_id
      JOIN public.monitoring_runs r ON r.id = a.run_id
      LEFT JOIN public.source_domains sd ON sd.project_id = c.project_id AND sd.domain = c.domain
      WHERE ${conditions.join(" AND ")}
      GROUP BY c.domain, coalesce(sd.source_type, c.source_type), sd.is_allowed, sd.is_denied
      ORDER BY citation_count DESC, c.domain ASC
    `;

    const res = await this.pool.query<{
      domain: string;
      source_type: string;
      citation_count: number;
      distinct_pages_count: number;
      engines: string[];
      is_allowed: boolean;
      is_denied: boolean;
      cites_brand: boolean;
    }>(queryStr, params);

    const totalCitations = res.rows.reduce((acc, r) => acc + r.citation_count, 0);

    return res.rows.map((row) => {
      const share =
        totalCitations > 0 ? Number((row.citation_count / totalCitations).toFixed(4)) : 0;
      const wilson = calculateWilsonInterval(row.citation_count, totalCitations);

      // Check if domain is or cites competitors
      const normDomain = this.normalizeHostname(row.domain);
      const citedComps: string[] = [];
      for (const comp of competitors) {
        if (normDomain.includes(comp.domain) || comp.domain.includes(normDomain)) {
          citedComps.push(comp.name);
        }
      }

      return {
        domain: row.domain,
        sourceType: (row.source_type as SourceType) || "other",
        citationCount: row.citation_count,
        citationShare: share,
        ciLow: wilson.low,
        ciHigh: wilson.high,
        distinctPagesCount: row.distinct_pages_count,
        engines: row.engines || [],
        trendStatus: "retained",
        delta: 0,
        isAllowed: row.is_allowed,
        isDenied: row.is_denied,
        citesBrand: row.cites_brand,
        citesCompetitors: citedComps,
      };
    });
  }

  // 3. Page Citations Aggregation (CIT-FR-003, CIT-FR-004)
  async listPageCitations(
    context: TenantContext,
    projectId: string,
    query: {
      days?: number;
      dateFrom?: string;
      dateTo?: string;
      engine?: string;
      domain?: string;
      onlyBrandPages?: boolean;
    } = {},
  ): Promise<PageCitationItem[]> {
    const project = await this.assertProjectAccess(context, projectId);
    const brandHost = this.normalizeHostname(project.domain);

    const conditions: string[] = [
      "c.project_id = $1",
      "c.tenant_id = $2",
      "r.status IN ('succeeded', 'refused')",
    ];
    const params: unknown[] = [projectId, context.tenantId];

    if (query.dateFrom) {
      params.push(new Date(query.dateFrom + "T00:00:00.000Z"));
      conditions.push(`r.created_at >= $${params.length}`);
    } else if (query.days) {
      params.push(new Date(Date.now() - query.days * 86400 * 1000));
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
    if (query.domain) {
      params.push(query.domain);
      conditions.push(`c.domain = $${params.length}`);
    }
    if (query.onlyBrandPages) {
      params.push(`%${brandHost}%`);
      conditions.push(`(c.domain LIKE $${params.length} OR c.source_type = 'brand')`);
    }

    const res = await this.pool.query<{
      url: string;
      normalized_url: string;
      domain: string;
      source_type: string;
      citation_count: number;
      engines: string[];
      prompts_count: number;
      is_brand_page: boolean;
    }>(
      `SELECT 
         c.url,
         c.normalized_url,
         c.domain,
         c.source_type,
         count(*)::int as citation_count,
         array_agg(DISTINCT coalesce(a.engine, r.request->>'engine')) as engines,
         count(DISTINCT coalesce(a.prompt_id, (r.request->>'promptId')::uuid))::int as prompts_count,
         bool_or(c.domain = '${brandHost}' OR c.domain LIKE '%${brandHost}%' OR c.source_type = 'brand') as is_brand_page
       FROM public.citations c
       JOIN public.answers a ON a.id = c.answer_id
       JOIN public.monitoring_runs r ON r.id = a.run_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY c.url, c.normalized_url, c.domain, c.source_type
       ORDER BY citation_count DESC, c.normalized_url ASC
       LIMIT 100`,
      params,
    );

    return res.rows.map((row) => ({
      url: row.url,
      normalizedUrl: row.normalized_url,
      domain: row.domain,
      sourceType: (row.source_type as SourceType) || "other",
      citationCount: row.citation_count,
      engines: row.engines || [],
      promptsCount: row.prompts_count,
      isBrandPage: row.is_brand_page,
      competitorsCited: [],
    }));
  }

  // 4. Citation Gap Analysis (CIT-FR-005, Feature CIT-F1 & CIT-FR-008)
  async getCitationGaps(
    context: TenantContext,
    projectId: string,
    query: {
      days?: number;
      dateFrom?: string;
      dateTo?: string;
      engine?: string;
      minOpportunityScore?: number;
    } = {},
  ): Promise<CitationGapItem[]> {
    const project = await this.assertProjectAccess(context, projectId);
    const brandHost = this.normalizeHostname(project.domain);

    const conditions: string[] = [
      "r.project_id = $1",
      "r.tenant_id = $2",
      "r.status IN ('succeeded', 'refused')",
    ];
    const params: unknown[] = [projectId, context.tenantId];

    if (query.dateFrom) {
      params.push(new Date(query.dateFrom + "T00:00:00.000Z"));
      conditions.push(`r.created_at >= $${params.length}`);
    } else if (query.days) {
      params.push(new Date(Date.now() - query.days * 86400 * 1000));
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

    // Step A: Find runs where at least one competitor is cited and brand is NOT cited
    // Feature CIT-F1 Acceptance requirement
    const gapRunsQuery = `
      SELECT 
        r.id as run_id,
        coalesce(a.prompt_id, (r.request->>'promptId')::uuid) as prompt_id,
        coalesce(p.body, '') as prompt_text,
        1::int as priority,
        coalesce(a.engine, r.request->>'engine', 'gemini') as engine,
        (
          SELECT array_agg(DISTINCT c_comp.domain) 
          FROM public.citations c_comp 
          WHERE c_comp.answer_id = a.id AND c_comp.source_type = 'competitor'
        ) as competitor_domains_cited,
        (
          SELECT array_agg(DISTINCT m.entity_name) 
          FROM public.mentions m 
          WHERE m.answer_id = a.id AND m.entity_type = 'competitor'
        ) as competitor_names_mentioned
      FROM public.monitoring_runs r
      JOIN public.answers a ON a.run_id = r.id
      LEFT JOIN public.monitoring_prompts p ON p.id = coalesce(a.prompt_id, (r.request->>'promptId')::uuid)
      WHERE ${conditions.join(" AND ")}
        -- Competitor is cited
        AND EXISTS (
          SELECT 1 FROM public.citations c 
          WHERE c.answer_id = a.id AND (
            c.source_type = 'competitor'
            OR EXISTS (SELECT 1 FROM public.competitors comp WHERE comp.project_id = r.project_id AND (c.domain = comp.domain OR comp.domain LIKE '%' || c.domain || '%'))
          )
        )
        -- Brand is NOT cited
        AND NOT EXISTS (
          SELECT 1 FROM public.citations c 
          WHERE c.answer_id = a.id AND (
            c.domain = '${brandHost}' 
            OR c.domain LIKE '%${brandHost}%' 
            OR c.source_type = 'brand'
          )
        )
    `;

    const gapRunsRes = await this.pool.query<{
      run_id: string;
      prompt_id: string | null;
      prompt_text: string;
      priority: number;
      engine: string;
      competitor_domains_cited: string[] | null;
      competitor_names_mentioned: string[] | null;
    }>(gapRunsQuery, params);

    if (gapRunsRes.rows.length === 0) {
      return [];
    }

    const gapRunIds = gapRunsRes.rows.map((r) => r.run_id);
    const runMap = new Map(gapRunsRes.rows.map((r) => [r.run_id, r]));

    // Step B: Query citations on these gap runs (excluding brand and direct competitor domains)
    const gapCitationsRes = await this.pool.query<{
      run_id: string;
      domain: string;
      url: string;
      source_type: string;
    }>(
      `SELECT 
         r.id as run_id,
         c.domain,
         c.url,
         coalesce(sd.source_type, c.source_type) as source_type
       FROM public.citations c
       JOIN public.answers a ON a.id = c.answer_id
       JOIN public.monitoring_runs r ON r.id = a.run_id
       LEFT JOIN public.source_domains sd ON sd.project_id = c.project_id AND sd.domain = c.domain
       WHERE r.id = ANY($1::uuid[])
         AND c.domain != '${brandHost}'
         AND c.domain NOT LIKE '%${brandHost}%'
         AND c.source_type != 'brand'
         AND c.source_type != 'competitor'`,
      [gapRunIds],
    );

    // Step C: Aggregate gaps by domain
    const gapsMap = new Map<
      string,
      {
        domain: string;
        pageUrl: string | null;
        sourceType: SourceType;
        gapRuns: Set<string>;
        competitorNames: Set<string>;
        prompts: Map<string, { promptId: string; text: string; priority: number }>;
      }
    >();

    for (const c of gapCitationsRes.rows) {
      const run = runMap.get(c.run_id);
      if (!run) continue;

      let entry = gapsMap.get(c.domain);
      if (!entry) {
        entry = {
          domain: c.domain,
          pageUrl: c.url,
          sourceType: (c.source_type as SourceType) || "other",
          gapRuns: new Set<string>(),
          competitorNames: new Set<string>(),
          prompts: new Map(),
        };
        gapsMap.set(c.domain, entry);
      }

      entry.gapRuns.add(c.run_id);

      if (run.competitor_names_mentioned) {
        for (const name of run.competitor_names_mentioned) {
          entry.competitorNames.add(name);
        }
      }

      if (run.prompt_id) {
        entry.prompts.set(run.prompt_id, {
          promptId: run.prompt_id,
          text: run.prompt_text || "Buyer comparison query",
          priority: run.priority || 1,
        });
      }
    }

    const result: CitationGapItem[] = [];

    for (const [, val] of gapsMap.entries()) {
      const frequency = val.gapRuns.size;
      const promptList = Array.from(val.prompts.values());
      const avgPriority =
        promptList.length > 0
          ? promptList.reduce((acc, p) => acc + p.priority, 0) / promptList.length
          : 1;

      // Modeled opportunity score: Frequency x AvgPriority x 10
      const opportunityScore = Number((frequency * avgPriority * 10).toFixed(2));

      // Tailored suggested action based on source type (CIT-FR-008)
      let suggestedAction =
        "Outreach to editorial team to ensure brand is cited on upcoming category lists.";
      if (val.sourceType === "review_comparison") {
        suggestedAction =
          "Submit product listing and review request to close competitor visibility gap.";
      } else if (val.sourceType === "forum_ugc") {
        suggestedAction =
          "Participate in community discussions on Reddit/Quora with verified technical content.";
      } else if (val.sourceType === "news_media") {
        suggestedAction =
          "Target journalists and editorial authors for inclusion in industry buyer roundups.";
      } else if (val.sourceType === "marketplace") {
        suggestedAction =
          "Claim vendor profile and encourage verified customer reviews on this marketplace.";
      } else if (val.sourceType === "encyclopedia") {
        suggestedAction =
          "Verify factual Wikipedia and reference citations to maintain verified secondary sources.";
      } else if (val.sourceType === "documentation_blog") {
        suggestedAction =
          "Contact author with updated technical benchmarks and content refresh proposal.";
      }

      result.push({
        domain: val.domain,
        pageUrl: val.pageUrl,
        sourceType: val.sourceType,
        gapRunsCount: frequency,
        opportunityScore,
        competitorNames: Array.from(val.competitorNames),
        prompts: promptList,
        suggestedAction,
      });
    }

    // Rank by opportunity score descending (Feature CIT-F1)
    result.sort((a, b) => b.opportunityScore - a.opportunityScore);

    // Save top opportunities into citation_opportunities table (CIT-FR-008)
    for (const opp of result.slice(0, 30)) {
      await this.pool.query(
        `INSERT INTO public.citation_opportunities (
           tenant_id, project_id, domain, page_url, source_type, gap_runs_count, 
           opportunity_score, competitor_names, prompt_ids, suggested_action, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')
         ON CONFLICT DO NOTHING`,
        [
          context.tenantId,
          projectId,
          opp.domain,
          opp.pageUrl,
          opp.sourceType,
          opp.gapRunsCount,
          opp.opportunityScore,
          JSON.stringify(opp.competitorNames),
          JSON.stringify(opp.prompts.map((p) => p.promptId)),
          opp.suggestedAction,
        ],
      );
    }

    if (query.minOpportunityScore !== undefined) {
      return result.filter((r) => r.opportunityScore >= query.minOpportunityScore!);
    }

    return result;
  }

  // 5. Broken Brand Citation Detection (CIT-FR-009)
  async detectBrokenBrandCitations(
    context: TenantContext,
    projectId: string,
    options: { checkLive?: boolean } = {},
  ): Promise<{ checkedCount: number; brokenCount: number; brokenCitations: BrokenCitationItem[] }> {
    const project = await this.assertProjectAccess(context, projectId);
    const brandHost = this.normalizeHostname(project.domain);

    // Find distinct brand cited URLs across answers
    const citationsRes = await this.pool.query<{
      citation_id: string;
      url: string;
      normalized_url: string;
      domain: string;
    }>(
      `SELECT DISTINCT ON (c.normalized_url)
         c.id as citation_id,
         c.url,
         c.normalized_url,
         c.domain
       FROM public.citations c
       WHERE c.project_id = $1 AND c.tenant_id = $2
         AND (c.domain = $3 OR c.domain LIKE '%' || $3 || '%' OR c.source_type = 'brand')
       LIMIT 100`,
      [projectId, context.tenantId, brandHost],
    );

    const detected: BrokenCitationItem[] = [];

    for (const c of citationsRes.rows) {
      let statusCode = 200;
      let redirectUrl: string | null = null;
      let errorMessage: string | null = null;

      if (options.checkLive !== false) {
        try {
          // SSRF / Safe check: use HEAD request with redirect: manual
          const response = await this.fetcher(c.url, {
            method: "HEAD",
            redirect: "manual",
            signal: AbortSignal.timeout(6000),
          });

          statusCode = response.status;
          if ([301, 302, 307, 308].includes(statusCode)) {
            redirectUrl = response.headers.get("Location") || null;
          } else if (statusCode >= 400) {
            errorMessage = `HTTP ${statusCode} ${response.statusText || "Error"}`;
          }
        } catch (err) {
          statusCode = 0;
          errorMessage = err instanceof Error ? err.message : "Network error / unreachable URL";
        }
      }

      // If broken (4xx, 5xx, or network failure) or redirected, record task
      if (statusCode >= 400 || statusCode === 0 || redirectUrl !== null) {
        const ins = await this.pool.query<BrokenCitationItem>(
          `INSERT INTO public.broken_citations (
             tenant_id, project_id, citation_id, url, normalized_url, domain, 
             status_code, redirect_url, error_message, task_status, checked_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', now())
           RETURNING id, citation_id as "citationId", url, normalized_url as "normalizedUrl",
                     domain, status_code as "statusCode", redirect_url as "redirectUrl",
                     error_message as "errorMessage", task_status as "taskStatus",
                     checked_at::text as "checkedAt", created_at::text as "createdAt"`,
          [
            context.tenantId,
            projectId,
            c.citation_id,
            c.url,
            c.normalized_url,
            c.domain,
            statusCode,
            redirectUrl,
            errorMessage,
          ],
        );
        if (ins.rows[0]) {
          detected.push(ins.rows[0]);
        }
      }
    }

    return {
      checkedCount: citationsRes.rows.length,
      brokenCount: detected.length,
      brokenCitations: detected,
    };
  }

  // 6. List Broken Citations (CIT-FR-009)
  async listBrokenCitations(
    context: TenantContext,
    projectId: string,
    query: { taskStatus?: string } = {},
  ): Promise<BrokenCitationItem[]> {
    await this.assertProjectAccess(context, projectId);

    const conditions = ["project_id = $1", "tenant_id = $2"];
    const params: unknown[] = [projectId, context.tenantId];

    if (query.taskStatus && query.taskStatus !== "all") {
      params.push(query.taskStatus);
      conditions.push(`task_status = $${params.length}`);
    }

    const res = await this.pool.query<BrokenCitationItem>(
      `SELECT 
         id,
         citation_id as "citationId",
         url,
         normalized_url as "normalizedUrl",
         domain,
         status_code as "statusCode",
         redirect_url as "redirectUrl",
         error_message as "errorMessage",
         task_status as "taskStatus",
         checked_at::text as "checkedAt",
         created_at::text as "createdAt"
       FROM public.broken_citations
       WHERE ${conditions.join(" AND ")}
       ORDER BY checked_at DESC`,
      params,
    );

    return res.rows;
  }

  // 7. Update Broken Citation Task Status (CIT-FR-009)
  async updateBrokenCitationStatus(
    context: TenantContext,
    projectId: string,
    id: string,
    status: "open" | "resolved" | "ignored",
  ) {
    await this.assertProjectAccess(context, projectId);

    const res = await this.pool.query(
      `UPDATE public.broken_citations 
       SET task_status = $1 
       WHERE id = $2 AND project_id = $3 AND tenant_id = $4 
       RETURNING id, task_status as "taskStatus"`,
      [status, id, projectId, context.tenantId],
    );

    if (!res.rows.length) {
      throw new ApiError(404, "Broken citation record not found", "NOT_FOUND");
    }

    return res.rows[0];
  }

  // 8. Source Domain Rules & Custom Overrides (CIT-FR-010)
  async listSourceDomains(context: TenantContext, projectId: string) {
    await this.assertProjectAccess(context, projectId);

    const res = await this.pool.query(
      `SELECT 
         id,
         tenant_id as "tenantId",
         project_id as "projectId",
         domain,
         source_type as "sourceType",
         is_allowed as "isAllowed",
         is_denied as "isDenied",
         notes,
         created_at as "createdAt",
         updated_at as "updatedAt"
       FROM public.source_domains
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY domain ASC`,
      [projectId, context.tenantId],
    );

    return res.rows;
  }

  async upsertSourceDomain(context: TenantContext, projectId: string, input: SourceDomainInput) {
    await this.assertProjectAccess(context, projectId);
    const domain = this.normalizeHostname(input.domain);

    const res = await this.pool.query(
      `INSERT INTO public.source_domains (
         tenant_id, project_id, domain, source_type, is_allowed, is_denied, notes, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (project_id, domain)
       DO UPDATE SET 
         source_type = EXCLUDED.source_type,
         is_allowed = EXCLUDED.is_allowed,
         is_denied = EXCLUDED.is_denied,
         notes = coalesce(EXCLUDED.notes, source_domains.notes),
         updated_at = now()
       RETURNING id, domain, source_type as "sourceType", is_allowed as "isAllowed", 
                 is_denied as "isDenied", notes, created_at as "createdAt"`,
      [
        context.tenantId,
        projectId,
        domain,
        input.sourceType || "other",
        input.isAllowed !== undefined ? input.isAllowed : true,
        input.isDenied !== undefined ? input.isDenied : false,
        input.notes || null,
      ],
    );

    return res.rows[0];
  }

  async deleteSourceDomain(context: TenantContext, projectId: string, domainId: string) {
    await this.assertProjectAccess(context, projectId);

    const res = await this.pool.query(
      `DELETE FROM public.source_domains 
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3 
       RETURNING id`,
      [domainId, projectId, context.tenantId],
    );

    if (!res.rows.length) {
      throw new ApiError(404, "Source domain rule not found", "NOT_FOUND");
    }

    return { success: true, id: domainId };
  }

  // 9. Export CSV (CIT-FR-011)
  async exportCsv(
    context: TenantContext,
    projectId: string,
    type: "domains" | "pages" | "gaps" | "broken" = "domains",
    query: CitationQuery = {},
  ): Promise<string> {
    if (type === "domains") {
      const items = await this.listDomainCitations(context, projectId, query);
      const headers = [
        "Domain",
        "SourceType",
        "CitationCount",
        "CitationShare",
        "CI_Low_95",
        "CI_High_95",
        "DistinctPages",
        "Engines",
        "CitesBrand",
        "CitesCompetitors",
      ];
      const rows = items.map((d) => [
        `"${d.domain.replaceAll('"', '""')}"`,
        d.sourceType,
        d.citationCount.toString(),
        (d.citationShare * 100).toFixed(2) + "%",
        d.ciLow !== undefined ? (d.ciLow * 100).toFixed(2) + "%" : "",
        d.ciHigh !== undefined ? (d.ciHigh * 100).toFixed(2) + "%" : "",
        d.distinctPagesCount.toString(),
        `"${d.engines.join(";")}"`,
        d.citesBrand ? "true" : "false",
        `"${d.citesCompetitors.join(";")}"`,
      ]);
      return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    }

    if (type === "pages") {
      const items = await this.listPageCitations(context, projectId, query);
      const headers = [
        "URL",
        "NormalizedURL",
        "Domain",
        "SourceType",
        "CitationCount",
        "Engines",
        "PromptsCount",
        "IsBrandPage",
      ];
      const rows = items.map((p) => [
        `"${p.url.replaceAll('"', '""')}"`,
        `"${p.normalizedUrl.replaceAll('"', '""')}"`,
        p.domain,
        p.sourceType,
        p.citationCount.toString(),
        `"${p.engines.join(";")}"`,
        p.promptsCount.toString(),
        p.isBrandPage ? "true" : "false",
      ]);
      return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    }

    if (type === "gaps") {
      const items = await this.getCitationGaps(context, projectId, query);
      const headers = [
        "Domain",
        "PageURL",
        "SourceType",
        "GapRunsCount",
        "OpportunityScore",
        "CompetitorsCited",
        "PromptsAffectedCount",
        "SuggestedAction",
      ];
      const rows = items.map((g) => [
        g.domain,
        g.pageUrl ? `"${g.pageUrl.replaceAll('"', '""')}"` : "",
        g.sourceType,
        g.gapRunsCount.toString(),
        g.opportunityScore.toFixed(2),
        `"${g.competitorNames.join(";")}"`,
        g.prompts.length.toString(),
        `"${g.suggestedAction.replaceAll('"', '""')}"`,
      ]);
      return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    }

    // Broken
    const items = await this.listBrokenCitations(context, projectId);
    const headers = [
      "URL",
      "NormalizedURL",
      "Domain",
      "StatusCode",
      "RedirectURL",
      "ErrorMessage",
      "TaskStatus",
      "CheckedAt",
    ];
    const rows = items.map((b) => [
      `"${b.url.replaceAll('"', '""')}"`,
      `"${b.normalizedUrl.replaceAll('"', '""')}"`,
      b.domain,
      b.statusCode.toString(),
      b.redirectUrl ? `"${b.redirectUrl.replaceAll('"', '""')}"` : "",
      b.errorMessage ? `"${b.errorMessage.replaceAll('"', '""')}"` : "",
      b.taskStatus,
      b.checkedAt,
    ]);
    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  }
}
