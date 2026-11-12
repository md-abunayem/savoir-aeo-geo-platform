import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { TenantContext } from "../../db/tenant.js";
import { ApiError } from "../../utils/ApiError.js";
import { AeoRuleEngine, type TechnicalGrade } from "./aeo-rule-engine.js";
import { FirecrawlCrawler, type CrawlerConfig } from "./firecrawl-crawler.js";

export interface TechnicalAuditServiceConfig extends CrawlerConfig {
  defaultPagesLimit?: number;
}

export interface TriggerAuditInput {
  crawlType?: "single_page" | "key_pages" | "full_site";
  pagesLimit?: number;
  targetDomain?: string;
}

export interface TechnicalAuditRecord {
  id: string;
  tenantId: string;
  projectId: string;
  status: "pending" | "running" | "completed" | "partial" | "failed" | "cancelled";
  crawlType: string;
  targetDomain: string;
  attemptedUrls: number | null;
  fetchedPages: number | null;
  failedRequests: number | null;
  httpErrorPages: number | null;
  excludedPages: number | null;
  pagesScored: number | null;
  queuedUrlsRemaining: number | null;
  pagesCrawled: number;
  pagesLimit: number;
  scoringVersion: number;
  completionReason: string | null;
  siteWideChecks: Record<string, unknown>;
  overallScore: number;
  grade: TechnicalGrade;
  categoryScores: {
    botAccess: number | null;
    indexability: number | null;
    schema: number | null;
    answerStructure: number | null;
    performanceTrust: number | null;
    agentReadability: number | null;
  };
  botMatrix: Record<string, unknown>;
  issuesSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  durationMs: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TechnicalAuditScheduleRecord {
  id: string;
  tenantId: string;
  projectId: string;
  frequency: "daily" | "weekly" | "monthly";
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export class TechnicalAuditService {
  private ruleEngine: AeoRuleEngine;
  private crawler: FirecrawlCrawler;

  constructor(
    private pool: Pool,
    private config: TechnicalAuditServiceConfig = {},
    private context?: TenantContext,
  ) {
    this.ruleEngine = new AeoRuleEngine();
    this.crawler = new FirecrawlCrawler(config);
  }

  forOwner(context: TenantContext) {
    return new TechnicalAuditService(this.pool, this.config, context);
  }

  private async authorize(client: PoolClient) {
    if (!this.context) return;
    const role = await client.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    if (!role.rows[0] || role.rows[0].rolsuper || role.rows[0].rolbypassrls)
      throw new ApiError(503, "Restricted database connection required", "UNSAFE_DATABASE_ROLE");
    await client.query(
      "SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)",
      [this.context.userId, this.context.tenantId],
    );
    const owner = await client.query(
      "SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='owner'",
      [this.context.tenantId, this.context.userId],
    );
    if (owner.rowCount !== 1) throw new ApiError(404, "Resource not found", "NOT_FOUND");
  }

  private async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
    if (!this.context) return this.pool.query<T>(text, values);
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      await this.authorize(client);
      const result = await client.query<T>(text, values);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  /**
   * 1. Trigger Site-Side Technical Audit (TEC-FR-001)
   */
  async triggerAudit(
    tenantId: string,
    projectId: string,
    input: TriggerAuditInput = {},
    requestKey?: string,
  ): Promise<{ auditId: string; status: string; targetDomain: string; pagesLimit: number }> {
    if (requestKey) {
      const existing = await this.query(
        "SELECT id,status,target_domain,pages_limit FROM technical_audits WHERE project_id=$1 AND tenant_id=$2 AND request_key=$3",
        [projectId, tenantId, requestKey],
      );
      if (existing.rows[0])
        return {
          auditId: existing.rows[0].id,
          status: existing.rows[0].status,
          targetDomain: existing.rows[0].target_domain,
          pagesLimit: existing.rows[0].pages_limit,
        };
    }
    // 1. Verify project exists & get default domain
    const projectRes = await this.query(
      `SELECT id, domain, status FROM public.projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );

    if (projectRes.rows.length === 0) {
      throw new ApiError(404, "Project not found", "PROJECT_NOT_FOUND");
    }

    const domain = input.targetDomain?.trim() || projectRes.rows[0].domain;
    if (!domain) {
      throw new ApiError(
        400,
        "Project has no domain configured for technical audit",
        "DOMAIN_REQUIRED",
      );
    }

    // 2. Prevent concurrent audits for same project
    const activeAuditRes = await this.query(
      `SELECT id FROM public.technical_audits 
       WHERE project_id = $1 AND tenant_id = $2 AND status IN ('pending', 'running')`,
      [projectId, tenantId],
    );

    if (activeAuditRes.rows.length > 0) {
      throw new ApiError(
        409,
        "A technical audit is already currently running for this project.",
        "AUDIT_ALREADY_RUNNING",
      );
    }

    const crawlType = input.crawlType || "full_site";
    const pagesLimit = Math.min(input.pagesLimit || this.config.defaultPagesLimit || 500, 500);

    // 3. Create initial audit record
    const insertRes = await this.query(
      `INSERT INTO public.technical_audits (
        tenant_id, project_id, status, crawl_type, target_domain, pages_limit, started_at, request_key
      ) VALUES ($1, $2, 'running', $3, $4, $5, now(), $6)
      ON CONFLICT (project_id,request_key) DO NOTHING
      RETURNING id, status, target_domain, pages_limit`,
      [tenantId, projectId, crawlType, domain, pagesLimit, requestKey ?? null],
    );

    if (!insertRes.rows[0]) return this.triggerAudit(tenantId, projectId, input, requestKey);
    const auditId = insertRes.rows[0].id as string;

    // Execute audit in background or sync depending on crawlType
    void this.executeAudit(auditId, tenantId, projectId, domain, crawlType, pagesLimit).catch(
      async (err) => {
        await this.query(
          `UPDATE public.technical_audits 
           SET status = 'failed', error_message = $1, completed_at = now(), updated_at = now()
           WHERE id = $2 AND tenant_id = $3 AND project_id = $4`,
          [
            err instanceof Error ? err.message : "Technical audit execution failed",
            auditId,
            tenantId,
            projectId,
          ],
        );
      },
    );

    return {
      auditId,
      status: "running",
      targetDomain: domain,
      pagesLimit,
    };
  }

  /**
   * 2. Execute Audit Pipeline
   */
  async executeAudit(
    auditId: string,
    tenantId: string,
    projectId: string,
    targetDomain: string,
    crawlType: "single_page" | "key_pages" | "full_site",
    pagesLimit: number,
  ): Promise<void> {
    const startTime = Date.now();

    // 1. Fetch site-wide files (robots.txt, llms.txt, sitemap references)
    const siteWide = await this.crawler.fetchSiteWideFiles(targetDomain);

    // 2. Evaluate AI Bot Access Matrix (TEC-FR-003)
    const botMatrix = this.ruleEngine.evaluateBotAccess(siteWide.robotsTxt, siteWide.robotsStatus);

    // 3. Crawl pages (respecting politeness 2 req/s)
    const crawlResult = await this.crawler.crawlDomainWithStats(targetDomain, {
      crawlType,
      pageLimit: pagesLimit,
      customCrawlDelaySeconds: siteWide.crawlDelaySeconds,
    });

    // 4. Evaluate each page
    const seenFinalUrls = new Set<string>();
    const duplicateTargets: Array<string | null> = [];
    const pageEvaluations = crawlResult.pages.map((page) => {
      let verifiedHostAliases: string[] = [];
      if (page.finalUrl) {
        const requestedHost = new URL(page.url).hostname.toLowerCase();
        const finalHost = new URL(page.finalUrl).hostname.toLowerCase();
        const stripWww = (host: string) => host.replace(/^www\./, "");
        if (requestedHost !== finalHost && stripWww(requestedHost) === stripWww(finalHost)) {
          verifiedHostAliases = [requestedHost, finalHost];
        }
      }

      const evaluation = this.ruleEngine.evaluatePage({
        url: page.url,
        finalUrl: page.finalUrl ?? undefined,
        verifiedHostAliases,
        path: page.path,
        statusCode: page.statusCode,
        crawlStatus: page.error
          ? "failed"
          : page.statusCode >= 200 && page.statusCode < 300
            ? "fetched"
            : "http_error",
        fetchError: page.error,
        headers: page.headers,
        rawHtml: page.rawHtml,
        renderedHtml: page.renderedHtml,
        source: page.source,
        loadTimeMs: page.loadTimeMs,
      });
      const final = page.finalUrl ? new URL(page.finalUrl) : null;
      if (final) final.hash = "";
      const identity = final?.href ?? page.url;
      const duplicate = evaluation.crawlStatus === "fetched" && seenFinalUrls.has(identity);
      duplicateTargets.push(duplicate ? identity : null);
      if (evaluation.crawlStatus === "fetched") seenFinalUrls.add(identity);
      if (duplicate) {
        evaluation.excluded = true;
        evaluation.exclusionReason = `Duplicate of ${identity}; this final URL is scored once.`;
        evaluation.pageScore = null;
        evaluation.issues = [];
      }
      return evaluation;
    });

    const fetchedPages = pageEvaluations.filter((page) => page.crawlStatus === "fetched").length;
    const failedRequests = pageEvaluations.filter((page) => page.crawlStatus === "failed").length;
    const httpErrorPages = pageEvaluations.filter(
      (page) => page.crawlStatus === "http_error",
    ).length;
    const excludedPages = pageEvaluations.filter((page) => page.excluded).length;

    // 5. Calculate Overall Score & Aggregates (TEC-FR-010)
    const overallResult = this.ruleEngine.calculateOverallAuditResult(botMatrix, pageEvaluations, {
      hasLlmsTxt: siteWide.hasLlmsTxt,
      hasSitemap: siteWide.hasSitemap,
      robotsStatus: siteWide.robotsStatus,
      robotsHttpStatus: siteWide.robotsHttpStatus,
      robotsError: siteWide.robotsError,
    });

    const durationMs = Date.now() - startTime;
    const hasUsablePages = overallResult.pagesScored > 0;
    const status = !hasUsablePages
      ? "failed"
      : failedRequests > 0 || httpErrorPages > 0 || crawlResult.queuedUrlsRemaining > 0
        ? "partial"
        : "completed";
    const completionReason = !hasUsablePages
      ? "No usable public pages were collected; no audit score is available."
      : status === "partial"
        ? `Partial crawl: ${failedRequests} request failures, ${httpErrorPages} HTTP errors, and ${crawlResult.queuedUrlsRemaining} URLs still queued.`
        : null;

    // 6. Persist Audit Pages & Issues in Transaction
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.authorize(client);

      // Update Audit Header
      await client.query(
        `UPDATE public.technical_audits SET
          status = $1,
          pages_crawled = $3,
          attempted_urls = $2,
          fetched_pages = $3,
          failed_requests = $4,
          http_error_pages = $5,
          excluded_pages = $6,
          pages_scored = $7,
          queued_urls_remaining = $8,
          completion_reason = $9,
          scoring_version = 3,
          site_wide_checks = $10,
          overall_score = $11,
          grade = $12,
          category_scores = $13,
          bot_matrix = $14,
          issues_summary = $15,
          duration_ms = $16,
          error_message = $17,
          completed_at = now(),
          updated_at = now()
        WHERE id = $18 AND tenant_id = $19 AND project_id = $20`,
        [
          status,
          crawlResult.attemptedUrls,
          fetchedPages,
          failedRequests,
          httpErrorPages,
          excludedPages,
          overallResult.pagesScored,
          crawlResult.queuedUrlsRemaining,
          completionReason,
          JSON.stringify({
            robotsStatus: siteWide.robotsStatus,
            robotsHttpStatus: siteWide.robotsHttpStatus,
            robotsError: siteWide.robotsError,
            llmsStatus: siteWide.llmsStatus,
            sitemapStatus: siteWide.sitemapStatus,
            sitemapUrls: siteWide.sitemapUrls,
          }),
          overallResult.overallScore,
          overallResult.grade,
          JSON.stringify(overallResult.categoryScores),
          JSON.stringify(overallResult.botMatrix),
          JSON.stringify(overallResult.issuesSummary),
          durationMs,
          status === "failed" ? completionReason : status === "partial" ? completionReason : null,
          auditId,
          tenantId,
          projectId,
        ],
      );

      // Insert Pages
      for (const [index, p] of pageEvaluations.entries()) {
        const pageRes = await client.query(
          `INSERT INTO public.technical_audit_pages (
            audit_id, tenant_id, project_id, url, path, status_code, is_indexable,
            final_url, fetch_error, crawl_status, excluded, exclusion_reason,
            canonical_url, canonical_status, page_score, word_count, heading_counts,
            answer_first_detected, faq_blocks_detected, schemas_detected, has_js_dom_diff,
            dom_diff_metrics, load_time_ms, issues_count, crawl_source, fallback_reason, duplicate_of
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
          RETURNING id`,
          [
            auditId,
            tenantId,
            projectId,
            p.url,
            p.path,
            p.statusCode,
            p.isIndexable,
            p.finalUrl,
            p.fetchError,
            p.crawlStatus,
            p.excluded,
            p.exclusionReason,
            p.canonicalUrl,
            p.canonicalStatus,
            p.pageScore,
            p.wordCount,
            JSON.stringify(p.headingCounts),
            p.answerFirstDetected,
            p.faqBlocksDetected,
            JSON.stringify(p.schemasDetected),
            p.hasJsDomDiff,
            JSON.stringify(p.domDiffMetrics),
            p.loadTimeMs,
            p.issues.length,
            crawlResult.pages[index]?.source ?? null,
            crawlResult.pages[index]?.fallbackReason ?? null,
            duplicateTargets[index],
          ],
        );

        const pageId = pageRes.rows[0].id as string;

        // Insert Page Issues
        for (const issue of p.issues) {
          await client.query(
            `INSERT INTO public.technical_audit_issues (
              audit_id, tenant_id, project_id, page_id, category, severity, code,
              title, description, recommendation, fix_snippet, affected_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              auditId,
              tenantId,
              projectId,
              pageId,
              issue.category,
              issue.severity,
              issue.code,
              issue.title,
              issue.description,
              issue.recommendation,
              issue.fixSnippet || null,
              issue.affectedUrl || p.url,
            ],
          );
        }
      }

      // Insert Site-Wide Issues (e.g. Bot access, llms.txt, sitemaps)
      const siteIssues = overallResult.issues.filter((i) => !i.affectedUrl);
      for (const issue of siteIssues) {
        await client.query(
          `INSERT INTO public.technical_audit_issues (
            audit_id, tenant_id, project_id, page_id, category, severity, code,
            title, description, recommendation, fix_snippet, affected_url
          ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, NULL)`,
          [
            auditId,
            tenantId,
            projectId,
            issue.category,
            issue.severity,
            issue.code,
            issue.title,
            issue.description,
            issue.recommendation,
            issue.fixSnippet || null,
          ],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 3. Get Latest Audit Overview (TEC-FR-011, TEC-FR-016)
   */
  async getLatestAudit(tenantId: string, projectId: string): Promise<TechnicalAuditRecord | null> {
    const res = await this.query(
      `SELECT * FROM public.technical_audits 
       WHERE project_id = $1 AND tenant_id = $2 
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, tenantId],
    );

    if (res.rows.length === 0) return null;
    return this.mapAuditRow(res.rows[0]);
  }

  /**
   * 4. Get Audit by ID
   */
  async getAuditById(
    tenantId: string,
    projectId: string,
    auditId: string,
  ): Promise<TechnicalAuditRecord> {
    const res = await this.query(
      `SELECT * FROM public.technical_audits 
       WHERE id = $1 AND project_id = $2 AND tenant_id = $3`,
      [auditId, projectId, tenantId],
    );

    if (res.rows.length === 0) {
      throw new ApiError(404, "Technical audit not found", "AUDIT_NOT_FOUND");
    }

    return this.mapAuditRow(res.rows[0]);
  }

  /**
   * 5. List Audit History (TEC-FR-013)
   */
  async listAudits(
    tenantId: string,
    projectId: string,
    limit = 10,
  ): Promise<TechnicalAuditRecord[]> {
    const res = await this.query(
      `SELECT * FROM public.technical_audits 
       WHERE project_id = $1 AND tenant_id = $2 
       ORDER BY created_at DESC LIMIT $3`,
      [projectId, tenantId, Math.min(limit, 50)],
    );

    return res.rows.map((r) => this.mapAuditRow(r));
  }

  async getSchedule(
    tenantId: string,
    projectId: string,
  ): Promise<TechnicalAuditScheduleRecord | null> {
    const res = await this.query(
      `SELECT * FROM public.technical_audit_schedules
       WHERE project_id = $1 AND tenant_id = $2 AND is_active
       LIMIT 1`,
      [projectId, tenantId],
    );
    return res.rows[0] ? this.mapScheduleRow(res.rows[0]) : null;
  }

  async saveSchedule(
    tenantId: string,
    projectId: string,
    userId: string,
    frequency: TechnicalAuditScheduleRecord["frequency"],
  ): Promise<TechnicalAuditScheduleRecord> {
    const project = await this.query(
      `SELECT 1 FROM public.projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );
    if (!project.rows[0]) throw new ApiError(404, "Project not found", "PROJECT_NOT_FOUND");

    const nextRunAt = new Date();
    if (frequency === "daily") nextRunAt.setUTCDate(nextRunAt.getUTCDate() + 1);
    else if (frequency === "weekly") nextRunAt.setUTCDate(nextRunAt.getUTCDate() + 7);
    else nextRunAt.setUTCMonth(nextRunAt.getUTCMonth() + 1);

    const res = await this.query(
      `INSERT INTO public.technical_audit_schedules (
        tenant_id, project_id, created_by, frequency, next_run_at
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (project_id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        created_by = EXCLUDED.created_by,
        frequency = EXCLUDED.frequency,
        is_active = true,
        next_run_at = EXCLUDED.next_run_at,
        updated_at = now()
      RETURNING *`,
      [tenantId, projectId, userId, frequency, nextRunAt],
    );
    return this.mapScheduleRow(res.rows[0]);
  }

  async deleteSchedule(tenantId: string, projectId: string): Promise<void> {
    await this.query(
      `DELETE FROM public.technical_audit_schedules
       WHERE project_id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );
  }

  async updateIssueStatus(
    tenantId: string,
    projectId: string,
    auditId: string,
    issueId: string,
    status: "open" | "fixed" | "dismissed",
  ): Promise<{ id: string; status: "open" | "fixed" | "dismissed" }> {
    await this.getAuditById(tenantId, projectId, auditId);
    const res = await this.query(
      `UPDATE public.technical_audit_issues
       SET status = $1
       WHERE id = $2 AND audit_id = $3 AND project_id = $4 AND tenant_id = $5
       RETURNING id, status`,
      [status, issueId, auditId, projectId, tenantId],
    );
    if (!res.rows[0]) throw new ApiError(404, "Technical audit issue not found", "ISSUE_NOT_FOUND");
    return {
      id: res.rows[0].id as string,
      status: res.rows[0].status as "open" | "fixed" | "dismissed",
    };
  }

  /**
   * 6. Get Audit Pages (TEC-FR-012)
   */
  async getAuditPages(
    tenantId: string,
    projectId: string,
    auditId: string,
    options: { page?: number; limit?: number; indexableOnly?: boolean; search?: string } = {},
  ): Promise<{
    pages: Array<{
      id: string;
      url: string;
      finalUrl: string | null;
      crawlSource: string | null;
      fallbackReason: string | null;
      duplicateOf: string | null;
      path: string;
      statusCode: number;
      crawlStatus: "fetched" | "http_error" | "failed" | "legacy";
      fetchError: string | null;
      excluded: boolean;
      exclusionReason: string | null;
      isIndexable: boolean;
      canonicalUrl: string | null;
      canonicalStatus: string;
      pageScore: number | null;
      wordCount: number;
      headingCounts: Record<string, number>;
      answerFirstDetected: boolean;
      faqBlocksDetected: boolean;
      schemasDetected: unknown[];
      hasJsDomDiff: boolean;
      loadTimeMs: number;
      issuesCount: number;
      createdAt: string;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    await this.getAuditById(tenantId, projectId, auditId);

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(1000, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["audit_id = $1", "project_id = $2", "tenant_id = $3"];
    const params: unknown[] = [auditId, projectId, tenantId];

    if (options.indexableOnly) {
      conditions.push("is_indexable = true");
    }

    if (options.search?.trim()) {
      params.push(`%${options.search.trim()}%`);
      conditions.push(`(url ILIKE $${params.length} OR final_url ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(" AND ");

    const countRes = await this.query(
      `SELECT COUNT(*)::int as total FROM public.technical_audit_pages WHERE ${whereClause}`,
      params,
    );

    const total = countRes.rows[0]?.total || 0;

    params.push(limit, offset);
    const rowsRes = await this.query(
      `SELECT * FROM public.technical_audit_pages 
       WHERE ${whereClause} 
       ORDER BY page_score ASC NULLS LAST, created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const pages = rowsRes.rows.map((r) => ({
      id: r.id as string,
      url: r.url as string,
      finalUrl: r.final_url as string | null,
      crawlSource: r.crawl_source as string | null,
      fallbackReason: r.fallback_reason as string | null,
      duplicateOf: r.duplicate_of as string | null,
      path: r.path as string,
      statusCode: r.status_code as number,
      crawlStatus: r.crawl_status as "fetched" | "http_error" | "failed",
      fetchError: r.fetch_error as string | null,
      excluded: r.excluded as boolean,
      exclusionReason: r.exclusion_reason as string | null,
      isIndexable: r.is_indexable as boolean,
      canonicalUrl: r.canonical_url as string | null,
      canonicalStatus: r.canonical_status as string,
      pageScore: r.page_score as number | null,
      wordCount: r.word_count as number,
      headingCounts: r.heading_counts as Record<string, number>,
      answerFirstDetected: r.answer_first_detected as boolean,
      faqBlocksDetected: r.faq_blocks_detected as boolean,
      schemasDetected: r.schemas_detected as unknown[],
      hasJsDomDiff: r.has_js_dom_diff as boolean,
      loadTimeMs: r.load_time_ms as number,
      issuesCount: r.issues_count as number,
      createdAt: (r.created_at as Date).toISOString(),
    }));

    return { pages, total, page, limit };
  }

  /**
   * 7. Get Audit Issues (TEC-FR-011)
   */
  async getAuditIssues(
    tenantId: string,
    projectId: string,
    auditId: string,
    options: {
      category?: string;
      severity?: string;
      findingType?: "problem" | "suggestion" | "information";
      search?: string;
    } = {},
  ): Promise<
    Array<{
      id: string;
      pageId: string | null;
      category: string;
      severity: string;
      findingType: "problem" | "suggestion" | "information";
      code: string;
      title: string;
      description: string;
      recommendation: string;
      fixSnippet: string | null;
      affectedUrl: string | null;
      status: "open" | "fixed" | "dismissed";
      createdAt: string;
    }>
  > {
    await this.getAuditById(tenantId, projectId, auditId);

    const conditions: string[] = ["audit_id = $1", "project_id = $2", "tenant_id = $3"];
    const params: unknown[] = [auditId, projectId, tenantId];

    if (options.category?.trim() && options.category !== "all") {
      params.push(options.category.trim());
      conditions.push(`category = $${params.length}`);
    }

    if (options.severity?.trim() && options.severity !== "all") {
      params.push(options.severity.trim());
      conditions.push(`severity = $${params.length}`);
    }

    if (options.findingType) {
      const severities =
        options.findingType === "problem"
          ? ["critical", "high"]
          : options.findingType === "suggestion"
            ? ["medium", "low"]
            : ["info"];
      params.push(severities);
      conditions.push(`severity = ANY($${params.length}::text[])`);
    }

    if (options.search?.trim()) {
      params.push(`%${options.search.trim()}%`);
      conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }

    const whereClause = conditions.join(" AND ");

    const res = await this.query(
      `SELECT * FROM public.technical_audit_issues 
       WHERE ${whereClause} 
       ORDER BY 
         CASE severity 
           WHEN 'critical' THEN 1 
           WHEN 'high' THEN 2 
           WHEN 'medium' THEN 3 
           WHEN 'low' THEN 4 
           ELSE 5 
         END, created_at ASC`,
      params,
    );

    return res.rows.map((r) => ({
      id: r.id as string,
      pageId: r.page_id as string | null,
      category: r.category as string,
      severity: r.severity as string,
      findingType:
        r.severity === "critical" || r.severity === "high"
          ? "problem"
          : r.severity === "medium" || r.severity === "low"
            ? "suggestion"
            : "information",
      code: r.code as string,
      title: r.title as string,
      description: r.description as string,
      recommendation: r.recommendation as string,
      fixSnippet: r.fix_snippet as string | null,
      affectedUrl: r.affected_url as string | null,
      status: (r.status ?? "open") as "open" | "fixed" | "dismissed",
      createdAt: (r.created_at as Date).toISOString(),
    }));
  }

  /**
   * 8. Export Audit CSV (RFC 4180) (TEC-FR-014)
   */
  async exportAuditCsv(
    tenantId: string,
    projectId: string,
    auditId: string,
    type: "pages" | "issues",
    filters: {
      findingType?: "problem" | "suggestion" | "information";
      category?: string;
      severity?: string;
      search?: string;
    } = {},
  ): Promise<string> {
    if (type === "pages") {
      const { pages } = await this.getAuditPages(tenantId, projectId, auditId, { limit: 1000 });
      const headers = [
        "URL",
        "Final URL",
        "Crawler",
        "Fallback Reason",
        "Duplicate Of",
        "Path",
        "Status Code",
        "Crawl Status",
        "Fetch Error",
        "Excluded",
        "Exclusion Reason",
        "Indexable",
        "Page Score",
        "Word Count",
        "Answer-First",
        "FAQ Blocks",
        "JS DOM Diff",
        "Fetch Duration Including Provider (ms)",
        "Issues Count",
      ];
      const rows = pages.map((p) => [
        this.csvEscape(p.url),
        this.csvEscape(p.finalUrl || ""),
        this.csvEscape(p.crawlSource || "unknown"),
        this.csvEscape(p.fallbackReason || ""),
        this.csvEscape(p.duplicateOf || ""),
        this.csvEscape(p.path),
        p.statusCode.toString(),
        this.csvEscape(p.crawlStatus),
        this.csvEscape(p.fetchError || ""),
        p.excluded ? "Yes" : "No",
        this.csvEscape(p.exclusionReason || ""),
        p.isIndexable ? "Yes" : "No",
        p.pageScore?.toString() || "",
        p.wordCount.toString(),
        p.answerFirstDetected ? "Yes" : "No",
        p.faqBlocksDetected ? "Yes" : "No",
        p.hasJsDomDiff ? "Yes" : "No",
        p.loadTimeMs.toString(),
        p.issuesCount.toString(),
      ]);
      return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    } else {
      const issues = await this.getAuditIssues(tenantId, projectId, auditId, {
        ...filters,
      });
      const headers = [
        "Finding Type",
        "Severity",
        "Status",
        "Category",
        "Code",
        "Title",
        "Affected URL",
        "Description",
        "Recommendation",
      ];
      const rows = issues.map((i) => [
        this.csvEscape(i.findingType),
        this.csvEscape(i.severity),
        this.csvEscape(i.status),
        this.csvEscape(i.category),
        this.csvEscape(i.code),
        this.csvEscape(i.title),
        this.csvEscape(i.affectedUrl || "Site-Wide"),
        this.csvEscape(i.description),
        this.csvEscape(i.recommendation),
      ]);
      return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    }
  }

  private csvEscape(value: string): string {
    if (
      value.includes(",") ||
      value.includes('"') ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private mapAuditRow(r: Record<string, unknown>): TechnicalAuditRecord {
    return {
      id: r.id as string,
      tenantId: r.tenant_id as string,
      projectId: r.project_id as string,
      status: r.status as TechnicalAuditRecord["status"],
      crawlType: r.crawl_type as string,
      targetDomain: r.target_domain as string,
      attemptedUrls: r.attempted_urls as number,
      fetchedPages: r.fetched_pages as number,
      failedRequests: r.failed_requests as number,
      httpErrorPages: r.http_error_pages as number,
      excludedPages: r.excluded_pages as number,
      pagesScored: r.pages_scored as number,
      queuedUrlsRemaining: r.queued_urls_remaining as number,
      pagesCrawled: r.pages_crawled as number,
      pagesLimit: r.pages_limit as number,
      scoringVersion: r.scoring_version as number,
      completionReason: r.completion_reason as string | null,
      siteWideChecks: r.site_wide_checks as Record<string, unknown>,
      overallScore: r.overall_score as number,
      grade: r.grade as TechnicalGrade,
      categoryScores: r.category_scores as TechnicalAuditRecord["categoryScores"],
      botMatrix: r.bot_matrix as Record<string, unknown>,
      issuesSummary: r.issues_summary as TechnicalAuditRecord["issuesSummary"],
      durationMs: r.duration_ms as number,
      errorMessage: r.error_message as string | null,
      startedAt: r.started_at ? (r.started_at as Date).toISOString() : null,
      completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : null,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  private mapScheduleRow(r: Record<string, unknown>): TechnicalAuditScheduleRecord {
    return {
      id: r.id as string,
      tenantId: r.tenant_id as string,
      projectId: r.project_id as string,
      frequency: r.frequency as TechnicalAuditScheduleRecord["frequency"],
      isActive: r.is_active as boolean,
      lastRunAt: r.last_run_at ? new Date(r.last_run_at as string | Date).toISOString() : null,
      nextRunAt: new Date(r.next_run_at as string | Date).toISOString(),
      createdAt: new Date(r.created_at as string | Date).toISOString(),
      updatedAt: new Date(r.updated_at as string | Date).toISOString(),
    };
  }
}
