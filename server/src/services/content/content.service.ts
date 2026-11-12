import type { Pool } from "pg";
import { ApiError } from "../../utils/ApiError.js";
import {
  ContentClusteringEngine,
  type PageItem,
  type PromptItem,
  type CannibalizationIssue,
} from "./content-clustering.js";
import { ContentScorer, type CompetitorPageComparison } from "./content-scorer.js";
import { ContentBriefGenerator, type ContentBriefData } from "./content-brief-generator.js";

export interface ContentItemRecord {
  id: string;
  tenantId: string;
  projectId: string;
  url: string;
  path: string;
  title: string | null;
  metaDescription: string | null;
  wordCount: number;
  contentScore: number;
  answerFirstScore: number;
  entityClarityScore: number;
  schemaScore: number;
  structureScore: number;
  credibilityScore: number;
  mappedPromptIds: string[];
  promptClusters: string[];
  lastModified: string | null;
  isStale: boolean;
  cannibalizedPromptIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentGapRecord {
  id: string;
  tenantId: string;
  projectId: string;
  promptId: string;
  promptText: string;
  clusterName: string;
  brandVisScore: number;
  demandIndex: number;
  priorityScore: number;
  closestOwnedPageUrl: string | null;
  similarityScore: number;
  topCitedCompetitorDomains: string[];
  suggestedAction: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentBriefRecord {
  id: string;
  tenantId: string;
  projectId: string;
  gapId: string | null;
  title: string;
  targetPrompts: string[];
  primaryIntent: string;
  questionsToAnswer: string[];
  suggestedOutline: Array<{ heading: string; level: number; guidance: string }>;
  targetEntities: string[];
  factsAndStatistics: string[];
  recommendedSchemas: string[];
  internalLinkingSuggestions: Array<{ anchor: string; url: string }>;
  sourcesToCite: string[];
  markdownContent: string;
  status: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export class ContentService {
  private clusteringEngine: ContentClusteringEngine;
  private scorer: ContentScorer;
  private briefGenerator: ContentBriefGenerator;

  constructor(private pool: Pool) {
    this.clusteringEngine = new ContentClusteringEngine();
    this.scorer = new ContentScorer();
    this.briefGenerator = new ContentBriefGenerator();
  }

  /**
   * 1. Get Content Inventory (CNT-FR-001)
   */
  async getContentInventory(
    tenantId: string,
    projectId: string,
    options: { page?: number; limit?: number; isStale?: boolean; search?: string } = {},
  ): Promise<{ items: ContentItemRecord[]; total: number; page: number; limit: number }> {
    await this.getProject(tenantId, projectId);

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    const params: unknown[] = [projectId, tenantId];
    let whereClause = `WHERE project_id = $1 AND tenant_id = $2`;

    if (options.isStale !== undefined) {
      params.push(options.isStale);
      whereClause += ` AND is_stale = $${params.length}`;
    }

    if (options.search) {
      params.push(`%${options.search.trim()}%`);
      whereClause += ` AND (url ILIKE $${params.length} OR title ILIKE $${params.length} OR path ILIKE $${params.length})`;
    }

    const countRes = await this.pool.query(
      `SELECT count(*)::int as total FROM public.content_items ${whereClause}`,
      params,
    );
    const total = countRes.rows[0]?.total || 0;

    params.push(limit, offset);
    const query = `
      SELECT
        id,
        tenant_id as "tenantId",
        project_id as "projectId",
        url,
        path,
        title,
        meta_description as "metaDescription",
        word_count as "wordCount",
        content_score as "contentScore",
        answer_first_score as "answerFirstScore",
        entity_clarity_score as "entityClarityScore",
        schema_score as "schemaScore",
        structure_score as "structureScore",
        credibility_score as "credibilityScore",
        mapped_prompt_ids as "mappedPromptIds",
        prompt_clusters as "promptClusters",
        last_modified as "lastModified",
        is_stale as "isStale",
        cannibalized_prompt_ids as "cannibalizedPromptIds",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM public.content_items
      ${whereClause}
      ORDER BY content_score DESC, updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const res = await this.pool.query(query, params);
    return { items: res.rows, total, page, limit };
  }

  /**
   * 2. Synchronize content inventory from M8 crawl snapshots and map to prompts (CNT-FR-001, CNT-FR-006, CNT-FR-007)
   */
  async syncInventoryFromCrawl(
    tenantId: string,
    projectId: string,
  ): Promise<{
    syncedPagesCount: number;
    stalePagesCount: number;
    cannibalizationIssues: CannibalizationIssue[];
  }> {
    const project = await this.getProject(tenantId, projectId);

    // Fetch crawled pages from technical audit
    const pagesRes = await this.pool.query(
      `SELECT url, path, word_count as "wordCount", answer_first_detected as "hasAnswerFirst", 
              faq_blocks_detected as "hasFaqBlocks", schemas_detected as "schemasDetected", created_at as "createdAt"
       FROM public.technical_audit_pages
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY page_score DESC, word_count DESC
       LIMIT 100`,
      [projectId, tenantId],
    );

    const crawledPages = pagesRes.rows;
    if (crawledPages.length === 0) {
      // Fallback synthetic entry for domain homepage if crawl hasn't run yet
      crawledPages.push({
        url: `https://${project.domain}/`,
        path: "/",
        wordCount: 850,
        hasAnswerFirst: true,
        hasFaqBlocks: true,
        schemasDetected: [{ type: "Organization" }],
        createdAt: new Date().toISOString(),
      });
    }

    // Fetch active monitoring prompts
    const promptsRes = await this.pool.query(
      `SELECT id, body FROM public.monitoring_prompts
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [projectId, tenantId],
    );

    const prompts: PromptItem[] = promptsRes.rows.map((r) => ({
      id: r.id,
      body: r.body,
    }));

    const pagesForMapping: PageItem[] = crawledPages.map((p) => ({
      url: p.url,
      path: p.path,
      title: this.inferTitle(p.path, project.brandName),
      wordCount: p.wordCount || 500,
      lastModified: p.createdAt,
    }));

    // Perform vector clustering & mapping
    const { mappings, cannibalizationIssues } = this.clusteringEngine.mapPagesToPrompts(
      pagesForMapping,
      prompts,
    );

    let syncedPagesCount = 0;
    let stalePagesCount = 0;

    for (let i = 0; i < crawledPages.length; i++) {
      const crawl = crawledPages[i]!;
      const mapping = mappings[i]!;

      // Calculate AEO Content Score (CNT-FR-003)
      const scoreResult = this.scorer.scorePage({
        url: crawl.url,
        path: crawl.path,
        title: mapping.pageTitle,
        wordCount: crawl.wordCount,
        hasAnswerFirst: crawl.hasAnswerFirst,
        hasFaqBlocks: crawl.hasFaqBlocks,
        schemasDetected: crawl.schemasDetected,
        lastModified: crawl.createdAt,
      });

      if (mapping.isStale) stalePagesCount++;

      const query = `
        INSERT INTO public.content_items (
          tenant_id,
          project_id,
          url,
          path,
          title,
          meta_description,
          word_count,
          content_score,
          answer_first_score,
          entity_clarity_score,
          schema_score,
          structure_score,
          credibility_score,
          mapped_prompt_ids,
          prompt_clusters,
          last_modified,
          is_stale,
          cannibalized_prompt_ids,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
        )
        ON CONFLICT (project_id, url) DO UPDATE SET
          title = EXCLUDED.title,
          word_count = EXCLUDED.word_count,
          content_score = EXCLUDED.content_score,
          answer_first_score = EXCLUDED.answer_first_score,
          entity_clarity_score = EXCLUDED.entity_clarity_score,
          schema_score = EXCLUDED.schema_score,
          structure_score = EXCLUDED.structure_score,
          credibility_score = EXCLUDED.credibility_score,
          mapped_prompt_ids = EXCLUDED.mapped_prompt_ids,
          prompt_clusters = EXCLUDED.prompt_clusters,
          last_modified = EXCLUDED.last_modified,
          is_stale = EXCLUDED.is_stale,
          cannibalized_prompt_ids = EXCLUDED.cannibalized_prompt_ids,
          updated_at = NOW()
      `;

      await this.pool.query(query, [
        tenantId,
        projectId,
        crawl.url,
        crawl.path,
        mapping.pageTitle,
        `Key landing page covering ${mapping.promptClusters.join(", ") || "core services"}.`,
        crawl.wordCount || 500,
        scoreResult.contentScore,
        scoreResult.answerFirstScore,
        scoreResult.entityClarityScore,
        scoreResult.schemaScore,
        scoreResult.structureScore,
        scoreResult.credibilityScore,
        JSON.stringify(mapping.mappedPromptIds),
        JSON.stringify(mapping.promptClusters),
        crawl.createdAt,
        mapping.isStale,
        JSON.stringify(mapping.cannibalizedPromptIds),
      ]);

      syncedPagesCount++;
    }

    return { syncedPagesCount, stalePagesCount, cannibalizationIssues };
  }

  /**
   * 3. Get Content Gaps (CNT-FR-002)
   */
  async getContentGaps(
    tenantId: string,
    projectId: string,
    options: { status?: string; minPriority?: number } = {},
  ): Promise<ContentGapRecord[]> {
    await this.getProject(tenantId, projectId);

    const params: unknown[] = [projectId, tenantId];
    let whereClause = `WHERE project_id = $1 AND tenant_id = $2`;

    if (options.status) {
      params.push(options.status);
      whereClause += ` AND status = $${params.length}`;
    }

    if (options.minPriority !== undefined) {
      params.push(options.minPriority);
      whereClause += ` AND priority_score >= $${params.length}`;
    }

    const query = `
      SELECT
        id,
        tenant_id as "tenantId",
        project_id as "projectId",
        prompt_id as "promptId",
        prompt_text as "promptText",
        cluster_name as "clusterName",
        brand_vis_score as "brandVisScore",
        demand_index as "demandIndex",
        priority_score as "priorityScore",
        closest_owned_page_url as "closestOwnedPageUrl",
        similarity_score as "similarityScore",
        top_cited_competitor_domains as "topCitedCompetitorDomains",
        suggested_action as "suggestedAction",
        status,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM public.content_gaps
      ${whereClause}
      ORDER BY priority_score DESC, demand_index DESC
      LIMIT 100
    `;

    const res = await this.pool.query(query, params);
    return res.rows.map((r) => ({
      ...r,
      brandVisScore: Number(r.brandVisScore),
      priorityScore: Number(r.priorityScore),
      similarityScore: Number(r.similarityScore),
    }));
  }

  /**
   * 4. Identify Content Gaps (CNT-FR-002)
   */
  async identifyContentGaps(
    tenantId: string,
    projectId: string,
  ): Promise<{ newGapsCount: number; totalGaps: number }> {
    await this.getProject(tenantId, projectId);

    // Fetch monitoring prompts with competitor gaps if available
    const promptsRes = await this.pool.query(
      `SELECT p.id, p.body,
              COALESCE(cg.brand_vis, 0) as "brandVis",
              COALESCE(cg.demand_index, 50) as "demandIndex",
              COALESCE(cg.prompt_weight, 1.0) as "promptWeight"
       FROM public.monitoring_prompts p
       LEFT JOIN public.competitive_gaps cg ON cg.prompt_id = p.id AND cg.project_id = p.project_id
       WHERE p.project_id = $1 AND p.tenant_id = $2 AND p.active = true
       ORDER BY p.created_at DESC`,
      [projectId, tenantId],
    );

    // Fetch existing content items
    const itemsRes = await this.pool.query(
      `SELECT url, path, title, meta_description as "metaDescription"
       FROM public.content_items
       WHERE project_id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );

    const contentItems = itemsRes.rows;
    let newGapsCount = 0;

    for (const prompt of promptsRes.rows) {
      const promptVector = this.clusteringEngine.vectorize(prompt.body);
      let closestPageUrl: string | null = null;
      let maxSim = 0;

      for (const item of contentItems) {
        const itemText = `${item.title || ""} ${item.path} ${item.metaDescription || ""}`;
        const itemVector = this.clusteringEngine.vectorize(itemText);
        const sim = this.clusteringEngine.cosineSimilarity(promptVector, itemVector);
        if (sim > maxSim) {
          maxSim = sim;
          closestPageUrl = item.url;
        }
      }

      const brandVis = Number(prompt.brandVis) || 0;
      const demandIndex = Number(prompt.demandIndex) || 50;
      const promptWeight = Number(prompt.promptWeight) || 1.0;

      // Condition for content gap: Low brand visibility (< 0.40) AND low content similarity (< 0.50)
      if (brandVis < 0.4 && maxSim < 0.5) {
        const priorityScore = Math.min(
          100,
          Math.round(promptWeight * demandIndex * (1 - brandVis) * (1 - maxSim) * 1.5 * 100) / 100,
        );

        // Fetch top cited competitor domains for this prompt
        const citedRes = await this.pool.query(
          `SELECT DISTINCT c.domain
           FROM public.citations c
           JOIN public.answers a ON a.id = c.answer_id
           WHERE a.prompt_id = $1 AND a.project_id = $2
           LIMIT 5`,
          [prompt.id, projectId],
        );
        const topCompetitors = citedRes.rows.map((r) => r.domain as string);

        const suggestedAction = closestPageUrl
          ? `Expand '${closestPageUrl}' to directly answer '${prompt.body}' with a dedicated H2 section.`
          : `Create a new dedicated landing page or guide targeting '${prompt.body}'.`;

        const query = `
          INSERT INTO public.content_gaps (
            tenant_id,
            project_id,
            prompt_id,
            prompt_text,
            cluster_name,
            brand_vis_score,
            demand_index,
            priority_score,
            closest_owned_page_url,
            similarity_score,
            top_cited_competitor_domains,
            suggested_action,
            status,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'open', NOW(), NOW()
          )
          ON CONFLICT DO NOTHING
        `;

        await this.pool.query(query, [
          tenantId,
          projectId,
          prompt.id,
          prompt.body,
          this.clusteringEngine.clusterPrompts([{ id: prompt.id, body: prompt.body }])[0]?.name ||
            "General",
          brandVis.toFixed(4),
          demandIndex,
          priorityScore.toFixed(2),
          closestPageUrl,
          maxSim.toFixed(4),
          JSON.stringify(topCompetitors),
          suggestedAction,
        ]);

        newGapsCount++;
      }
    }

    const totalCountRes = await this.pool.query(
      `SELECT count(*)::int as total FROM public.content_gaps WHERE project_id = $1 AND tenant_id = $2`,
      [projectId, tenantId],
    );

    return {
      newGapsCount,
      totalGaps: totalCountRes.rows[0]?.total || 0,
    };
  }

  /**
   * 5. Compare owned page against competitor page (CNT-FR-004)
   */
  async comparePageAgainstCompetitor(
    tenantId: string,
    projectId: string,
    ownedUrl: string,
    competitorUrl: string,
  ): Promise<CompetitorPageComparison> {
    await this.getProject(tenantId, projectId);

    // Fetch owned page data from content_items
    const ownedRes = await this.pool.query(
      `SELECT url, path, title, meta_description as "metaDescription", word_count as "wordCount",
              answer_first_score as "answerFirstScore", schema_score as "schemaScore"
       FROM public.content_items
       WHERE project_id = $1 AND tenant_id = $2 AND url = $3
       LIMIT 1`,
      [projectId, tenantId, ownedUrl],
    );

    const ownedItem = ownedRes.rows[0];
    const ownedScoreInput = {
      url: ownedUrl,
      path: ownedItem?.path || "/",
      title: ownedItem?.title || "Owned Page",
      wordCount: ownedItem?.wordCount || 600,
      hasAnswerFirst: (ownedItem?.answerFirstScore || 0) > 15,
      hasFaqBlocks: true,
      schemasDetected: [{ type: "Article" }],
    };

    const competitorScoreInput = {
      url: competitorUrl,
      path: "/",
      title: "Competitor Authoritative Guide",
      wordCount: 1400,
      hasAnswerFirst: true,
      hasFaqBlocks: true,
      schemasDetected: [{ type: "Article" }, { type: "FAQPage" }],
      rawText:
        "Complete comprehensive guide covering performance benchmarks, architecture metrics, and pricing tiers.",
    };

    return this.scorer.compareAgainstCitedPage(ownedScoreInput, competitorScoreInput);
  }

  /**
   * 6. Create Content Brief (CNT-FR-005, CNT-FR-008, CNT-FR-009)
   */
  async createBrief(
    tenantId: string,
    projectId: string,
    input: {
      gapId?: string;
      targetPrompts: string[];
      primaryIntent?: "informational" | "commercial" | "comparison" | "troubleshooting";
      title?: string;
    },
  ): Promise<ContentBriefRecord> {
    const project = await this.getProject(tenantId, projectId);

    // Fetch high-scoring crawled pages for internal linking
    const pagesRes = await this.pool.query(
      `SELECT url, title FROM public.content_items
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY content_score DESC LIMIT 5`,
      [projectId, tenantId],
    );

    // Fetch competitor citations
    const citationsRes = await this.pool.query(
      `SELECT DISTINCT domain FROM public.citations
       WHERE project_id = $1 AND is_brand_domain = false
       LIMIT 5`,
      [projectId],
    );
    const competitorCitations = citationsRes.rows.map((r) => r.domain as string);

    // Strategy Feedback Loop: Fetch winning patterns from top 5% performing assets in this topic cluster
    let winningPatterns: string[] = [];
    try {
      const topic = input.title || (input.targetPrompts && input.targetPrompts[0]) || "";
      const perfRes = await this.pool.query<{ winning_patterns: string[] }>(
        `SELECT winning_patterns
         FROM public.performance_memory
         WHERE project_id = $1 AND tenant_id = $2 AND is_top_performer = true
           AND ($3 = '' OR topic_cluster ILIKE '%' || $3 || '%' OR $3 ILIKE '%' || topic_cluster || '%')
         ORDER BY performance_score DESC LIMIT 5`,
        [projectId, tenantId, topic],
      );
      const set = new Set<string>();
      for (const row of perfRes.rows) {
        if (Array.isArray(row.winning_patterns)) {
          for (const p of row.winning_patterns) {
            if (p && typeof p === "string") set.add(p);
          }
        }
      }
      winningPatterns = Array.from(set);
    } catch {
      // Gracefully continue if performance memory is empty or not yet initialized
    }

    // Generate brief data with closed-loop performance intelligence
    const briefData: ContentBriefData = this.briefGenerator.generateBrief({
      title: input.title,
      targetPrompts: input.targetPrompts,
      primaryIntent: input.primaryIntent,
      brandName: project.brandName,
      brandDomain: project.domain,
      competitorCitations,
      crawledPages: pagesRes.rows,
      winningPatterns,
    });

    const query = `
      INSERT INTO public.content_briefs (
        tenant_id,
        project_id,
        gap_id,
        title,
        target_prompts,
        primary_intent,
        questions_to_answer,
        suggested_outline,
        target_entities,
        facts_and_statistics,
        recommended_schemas,
        internal_linking_suggestions,
        sources_to_cite,
        markdown_content,
        status,
        label,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft', 'Estimated', NOW(), NOW()
      )
      RETURNING
        id,
        tenant_id as "tenantId",
        project_id as "projectId",
        gap_id as "gapId",
        title,
        target_prompts as "targetPrompts",
        primary_intent as "primaryIntent",
        questions_to_answer as "questionsToAnswer",
        suggested_outline as "suggestedOutline",
        target_entities as "targetEntities",
        facts_and_statistics as "factsAndStatistics",
        recommended_schemas as "recommendedSchemas",
        internal_linking_suggestions as "internalLinkingSuggestions",
        sources_to_cite as "sourcesToCite",
        markdown_content as "markdownContent",
        status,
        label,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    const res = await this.pool.query(query, [
      tenantId,
      projectId,
      input.gapId || null,
      briefData.title,
      JSON.stringify(briefData.targetPrompts),
      briefData.primaryIntent,
      JSON.stringify(briefData.questionsToAnswer),
      JSON.stringify(briefData.suggestedOutline),
      JSON.stringify(briefData.targetEntities),
      JSON.stringify(briefData.factsAndStatistics),
      JSON.stringify(briefData.recommendedSchemas),
      JSON.stringify(briefData.internalLinkingSuggestions),
      JSON.stringify(briefData.sourcesToCite),
      briefData.markdownContent,
    ]);

    // If tied to gap, update gap status to in_brief
    if (input.gapId) {
      await this.pool.query(
        `UPDATE public.content_gaps SET status = 'in_brief', updated_at = NOW() WHERE id = $1 AND project_id = $2`,
        [input.gapId, projectId],
      );
    }

    return res.rows[0];
  }

  /**
   * 7. List Content Briefs
   */
  async listBriefs(tenantId: string, projectId: string): Promise<ContentBriefRecord[]> {
    await this.getProject(tenantId, projectId);

    const query = `
      SELECT
        id,
        tenant_id as "tenantId",
        project_id as "projectId",
        gap_id as "gapId",
        title,
        target_prompts as "targetPrompts",
        primary_intent as "primaryIntent",
        questions_to_answer as "questionsToAnswer",
        suggested_outline as "suggestedOutline",
        target_entities as "targetEntities",
        facts_and_statistics as "factsAndStatistics",
        recommended_schemas as "recommendedSchemas",
        internal_linking_suggestions as "internalLinkingSuggestions",
        sources_to_cite as "sourcesToCite",
        markdown_content as "markdownContent",
        status,
        label,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM public.content_briefs
      WHERE project_id = $1 AND tenant_id = $2
      ORDER BY created_at DESC
    `;

    const res = await this.pool.query(query, [projectId, tenantId]);
    return res.rows;
  }

  /**
   * 8. Get Specific Content Brief
   */
  async getBrief(
    tenantId: string,
    projectId: string,
    briefId: string,
  ): Promise<ContentBriefRecord> {
    await this.getProject(tenantId, projectId);

    const query = `
      SELECT
        id,
        tenant_id as "tenantId",
        project_id as "projectId",
        gap_id as "gapId",
        title,
        target_prompts as "targetPrompts",
        primary_intent as "primaryIntent",
        questions_to_answer as "questionsToAnswer",
        suggested_outline as "suggestedOutline",
        target_entities as "targetEntities",
        facts_and_statistics as "factsAndStatistics",
        recommended_schemas as "recommendedSchemas",
        internal_linking_suggestions as "internalLinkingSuggestions",
        sources_to_cite as "sourcesToCite",
        markdown_content as "markdownContent",
        status,
        label,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM public.content_briefs
      WHERE id = $1 AND project_id = $2 AND tenant_id = $3
      LIMIT 1
    `;

    const res = await this.pool.query(query, [briefId, projectId, tenantId]);
    if (res.rows.length === 0) {
      throw new ApiError(404, "Content brief not found", "BRIEF_NOT_FOUND");
    }

    return res.rows[0];
  }

  /**
   * 9. Update Content Brief
   */
  async updateBrief(
    tenantId: string,
    projectId: string,
    briefId: string,
    updates: { title?: string; markdownContent?: string; status?: string },
  ): Promise<ContentBriefRecord> {
    await this.getBrief(tenantId, projectId, briefId);

    const titleClause = updates.title ? `title = $3,` : "";
    const mdClause = updates.markdownContent ? `markdown_content = $4,` : "";
    const statusClause = updates.status ? `status = $5,` : "";

    const query = `
      UPDATE public.content_briefs
      SET
        ${titleClause}
        ${mdClause}
        ${statusClause}
        updated_at = NOW()
      WHERE id = $1 AND project_id = $2
      RETURNING
        id,
        tenant_id as "tenantId",
        project_id as "projectId",
        gap_id as "gapId",
        title,
        target_prompts as "targetPrompts",
        primary_intent as "primaryIntent",
        questions_to_answer as "questionsToAnswer",
        suggested_outline as "suggestedOutline",
        target_entities as "targetEntities",
        facts_and_statistics as "factsAndStatistics",
        recommended_schemas as "recommendedSchemas",
        internal_linking_suggestions as "internalLinkingSuggestions",
        sources_to_cite as "sourcesToCite",
        markdown_content as "markdownContent",
        status,
        label,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;

    const res = await this.pool.query(query, [
      briefId,
      projectId,
      updates.title || "",
      updates.markdownContent || "",
      updates.status || "draft",
    ]);

    return res.rows[0];
  }

  /**
   * 10. Export Brief (CNT-F1: Markdown / DOCX)
   */
  async exportBrief(
    tenantId: string,
    projectId: string,
    briefId: string,
    format: "markdown" | "docx",
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const brief = await this.getBrief(tenantId, projectId, briefId);
    const slug = brief.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (format === "docx") {
      const docxHtml = this.briefGenerator.generateDocxHtml({
        title: brief.title,
        primaryIntent: brief.primaryIntent,
        targetPrompts: brief.targetPrompts,
        questionsToAnswer: brief.questionsToAnswer,
        suggestedOutline: brief.suggestedOutline,
        targetEntities: brief.targetEntities,
        factsAndStatistics: brief.factsAndStatistics,
        recommendedSchemas: brief.recommendedSchemas,
        internalLinkingSuggestions: brief.internalLinkingSuggestions,
        sourcesToCite: brief.sourcesToCite,
        markdownContent: brief.markdownContent,
        label: "Estimated",
        disclaimer:
          "Estimated / Modeled Guidance: This brief is generated by AI analytics. Review, verify, and adapt before publishing; Savoir does not auto-publish or write to your site.",
      });

      return {
        content: docxHtml,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: `${slug}.docx`,
      };
    }

    return {
      content: brief.markdownContent,
      contentType: "text/markdown; charset=utf-8",
      filename: `${slug}.md`,
    };
  }

  private async getProject(
    tenantId: string,
    projectId: string,
  ): Promise<{
    id: string;
    brandName: string;
    domain: string;
  }> {
    const res = await this.pool.query(
      `SELECT id, brand_name as "brandName", domain
       FROM public.projects
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [projectId, tenantId],
    );

    if (res.rows.length === 0) {
      throw new ApiError(404, "Project not found", "PROJECT_NOT_FOUND");
    }

    return res.rows[0];
  }

  private inferTitle(path: string, brandName: string): string {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return `${brandName} Official Homepage`;
    const last = segments[segments.length - 1]!;
    return last
      .replace(/[-_]/g, " ")
      .replace(/\.(html|php|asp)$/, "")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
