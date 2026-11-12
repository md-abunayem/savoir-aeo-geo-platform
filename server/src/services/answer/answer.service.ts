import type { Pool } from "pg";
import { ApiError } from "../../utils/ApiError.js";
import { extractCitations } from "./citation-extractor.js";

export interface TenantContext {
  tenantId: string;
  userId: string;
  role?: string;
}

export interface ListAnswersQuery {
  engine?: string;
  promptId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  geo?: string;
  language?: string;
  brandMentioned?: "true" | "false";
  competitorId?: string;
  sentiment?: "-1" | "0" | "1";
  citationDomain?: string;
  status?: string;
  limit?: number;
  offset?: number;
  format?: "json" | "csv";
}

export interface FlagAnswerInput {
  reason: string;
  note?: string;
  tags?: string[];
}

export interface CompareAnswersQuery {
  promptId?: string;
  answerId1?: string;
  answerId2?: string;
}
function groundingStatus(
  grounded: unknown,
  citations: unknown,
): "grounded" | "no_sources" | "unknown" {
  if (typeof grounded !== "boolean") return "unknown";
  return grounded && Array.isArray(citations) && citations.length > 0 ? "grounded" : "no_sources";
}
function answerTextUrls(text: string) {
  return extractCitations(text).map(({ url, anchorText }) => ({
    url,
    title: anchorText ?? "",
  }));
}

export class AnswerService {
  constructor(private readonly pool: Pool) {}

  private async assertProjectAccess(context: TenantContext, projectId: string) {
    const res = await this.pool.query(
      `SELECT 1 FROM public.projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, context.tenantId],
    );
    if (!res.rows.length) {
      throw new ApiError(404, "Project not found or access denied", "PROJECT_NOT_FOUND");
    }
  }

  async listAnswers(context: TenantContext, projectId: string, query: ListAnswersQuery) {
    await this.assertProjectAccess(context, projectId);

    const conditions: string[] = ["a.project_id = $1", "a.tenant_id = $2"];
    const params: unknown[] = [projectId, context.tenantId];
    let paramIdx = 3;

    if (query.engine) {
      conditions.push(`a.engine = $${paramIdx++}`);
      params.push(query.engine);
    }

    if (query.promptId) {
      conditions.push(`a.prompt_id = $${paramIdx++}`);
      params.push(query.promptId);
    }

    if (query.geo) {
      conditions.push(`a.geo = $${paramIdx++}`);
      params.push(query.geo.toUpperCase());
    }

    if (query.language) {
      conditions.push(`a.language = $${paramIdx++}`);
      params.push(query.language.toLowerCase());
    }

    if (query.search) {
      conditions.push(
        `(to_tsvector('english', a.text) @@ plainto_tsquery('english', $${paramIdx}) OR a.text ILIKE $${paramIdx + 1})`,
      );
      params.push(query.search);
      params.push(`%${query.search}%`);
      paramIdx += 2;
    }

    if (query.dateFrom) {
      conditions.push(`a.created_at >= $${paramIdx++}`);
      params.push(new Date(query.dateFrom).toISOString());
    }

    if (query.dateTo) {
      conditions.push(`a.created_at <= $${paramIdx++}`);
      params.push(new Date(query.dateTo).toISOString());
    }

    if (query.brandMentioned === "true") {
      conditions.push(
        `EXISTS (SELECT 1 FROM public.mentions m WHERE m.answer_id = a.id AND m.entity_type = 'brand')`,
      );
    } else if (query.brandMentioned === "false") {
      conditions.push(
        `NOT EXISTS (SELECT 1 FROM public.mentions m WHERE m.answer_id = a.id AND m.entity_type = 'brand')`,
      );
    }

    if (query.competitorId) {
      conditions.push(
        `EXISTS (SELECT 1 FROM public.mentions m WHERE m.answer_id = a.id AND m.entity_id = $${paramIdx++})`,
      );
      params.push(query.competitorId);
    }

    if (query.sentiment) {
      conditions.push(
        `EXISTS (SELECT 1 FROM public.mentions m WHERE m.answer_id = a.id AND m.sentiment = $${paramIdx++})`,
      );
      params.push(parseInt(query.sentiment, 10));
    }

    if (query.citationDomain) {
      conditions.push(
        `EXISTS (SELECT 1 FROM public.citations c WHERE c.answer_id = a.id AND c.domain ILIKE $${paramIdx++})`,
      );
      params.push(`%${query.citationDomain}%`);
    }

    if (query.status) {
      conditions.push(`mr.status = $${paramIdx++}`);
      params.push(query.status);
    }

    const whereClause = conditions.join(" AND ");

    // Count total
    const countSql = `
      SELECT COUNT(DISTINCT a.id)::int as total
      FROM public.answers a
      JOIN public.monitoring_runs mr ON a.run_id = mr.id
      WHERE ${whereClause}
    `;
    const countRes = await this.pool.query<{ total: number }>(countSql, params);
    const total = countRes.rows[0]?.total || 0;

    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const offset = Math.max(0, query.offset || 0);

    const selectSql = `
      SELECT 
        a.id, a.tenant_id as "tenantId", a.project_id as "projectId", a.run_id as "runId",
        a.prompt_id as "promptId", a.engine, a.engine_model as "engineModel",
        a.geo, a.language, a.text, a.text_ref as "textRef", a.parser_version as "parserVersion",
        a.has_citations as "hasCitations", a.refusal_flag as "refusalFlag",
        a.source_type as "sourceType", a.latency_ms as "latencyMs",
        a.tokens_used as "tokensUsed", a.created_at as "createdAt",
        p.brand_name as "brandName",
        mp.body as "promptText", mr.status as "runStatus",
        mr.result->'grounded' AS "providerGrounded",
        mr.result->'citations' AS "providerCitations",
        coalesce(
          (SELECT json_agg(
            json_build_object(
              'id', m.id,
              'entityType', m.entity_type,
              'entityId', m.entity_id,
              'entityName', m.entity_name,
              'matchedText', m.matched_text,
              'positionIndex', m.position_index,
              'listRank', m.list_rank,
              'sentiment', m.sentiment,
              'confidence', m.confidence,
              'label', m.label
            ) ORDER BY m.position_index ASC
          ) FROM public.mentions m WHERE m.answer_id = a.id),
          '[]'::json
        ) as mentions,
        coalesce(
          (SELECT json_agg(
            json_build_object(
              'domain', c.domain,
              'sourceType', c.source_type
            ) ORDER BY c.order_index ASC
          ) FROM public.citations c WHERE c.answer_id = a.id),
          '[]'::json
        ) as citations,
        (SELECT COUNT(*)::int FROM public.answer_flags af WHERE af.answer_id = a.id) as "flagsCount"
      FROM public.answers a
      JOIN public.projects p ON a.project_id = p.id
      JOIN public.monitoring_runs mr ON a.run_id = mr.id
      LEFT JOIN public.monitoring_prompts mp ON a.prompt_id = mp.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    params.push(limit, offset);
    const answersRes = await this.pool.query(selectSql, params);

    // Format output
    const items = answersRes.rows.map((row) => {
      const mentionsList = Array.isArray(row.mentions) ? row.mentions : [];
      const brandMention = mentionsList.find(
        (m: { entityType: string }) => m.entityType === "brand",
      );
      const citationsList = Array.isArray(row.citations) ? row.citations : [];
      const domains = Array.from(new Set(citationsList.map((c: { domain: string }) => c.domain)));

      return {
        ...row,
        groundingStatus: groundingStatus(row.providerGrounded, row.providerCitations),
        providerCitations: Array.isArray(row.providerCitations) ? row.providerCitations : [],
        answerTextUrls: answerTextUrls(String(row.text ?? "")),
        brandMentioned: Boolean(brandMention),
        brandSentiment: brandMention ? brandMention.sentiment : null,
        brandPosition: brandMention ? brandMention.positionIndex : null,
        brandListRank: brandMention ? brandMention.listRank : null,
        citationsCount: citationsList.length,
        citationDomains: domains,
      };
    });

    if (query.format === "csv") {
      return {
        csv: this.generateCsv(items),
        total,
        limit,
        offset,
      };
    }

    return {
      answers: items,
      total,
      limit,
      offset,
    };
  }

  async getAnswerById(context: TenantContext, projectId: string, answerId: string) {
    await this.assertProjectAccess(context, projectId);

    const answerSql = `
      SELECT 
        a.id, a.tenant_id as "tenantId", a.project_id as "projectId", a.run_id as "runId",
        a.prompt_id as "promptId", a.engine, a.engine_model as "engineModel",
        a.geo, a.language, a.text, a.text_ref as "textRef", a.text_hash as "textHash",
        a.parser_version as "parserVersion", a.has_citations as "hasCitations",
        a.refusal_flag as "refusalFlag", a.source_type as "sourceType",
        a.search_queries as "searchQueries", a.latency_ms as "latencyMs",
        a.tokens_used as "tokensUsed", a.raw_response as "rawResponse",
        a.created_at as "createdAt",
        mp.body as "promptText", mp.persona as "promptPersona",
        mr.status as "runStatus",
        mr.result->'grounded' AS "providerGrounded",
        mr.result->'citations' AS "providerCitations"
      FROM public.answers a
      JOIN public.projects p ON a.project_id = p.id
      JOIN public.monitoring_runs mr ON a.run_id = mr.id
      LEFT JOIN public.monitoring_prompts mp ON a.prompt_id = mp.id
      WHERE a.id = $1 AND a.project_id = $2 AND a.tenant_id = $3
    `;
    const res = await this.pool.query(answerSql, [answerId, projectId, context.tenantId]);
    const answer = res.rows[0];

    if (!answer) {
      throw new ApiError(404, "Answer not found", "ANSWER_NOT_FOUND");
    }

    // Fetch mentions
    const mentionsRes = await this.pool.query(
      `SELECT 
        id, entity_type as "entityType", entity_id as "entityId",
        entity_name as "entityName", matched_text as "matchedText",
        position_index as "positionIndex", list_rank as "listRank",
        sentiment, confidence, snippet, review_status as "reviewStatus",
        label, created_at as "createdAt"
      FROM public.mentions
      WHERE answer_id = $1
      ORDER BY position_index ASC`,
      [answerId],
    );

    // Fetch citations
    const citationsRes = await this.pool.query(
      `SELECT 
        id, url, normalized_url as "normalizedUrl", domain,
        source_type as "sourceType", anchor_text as "anchorText",
        order_index as "orderIndex", created_at as "createdAt"
      FROM public.citations
      WHERE answer_id = $1
      ORDER BY order_index ASC`,
      [answerId],
    );

    // Fetch claims
    const claimsRes = await this.pool.query(
      `SELECT 
        id, entity_name as "entityName", claim_text as "claimText",
        theme, sentiment, confidence, label, created_at as "createdAt"
      FROM public.claims
      WHERE answer_id = $1`,
      [answerId],
    );

    // Fetch flags
    const flagsRes = await this.pool.query(
      `SELECT 
        id, user_id as "userId", reason, note, tags, status,
        created_at as "createdAt", resolved_at as "resolvedAt"
      FROM public.answer_flags
      WHERE answer_id = $1
      ORDER BY created_at DESC`,
      [answerId],
    );

    return {
      ...answer,
      groundingStatus: groundingStatus(answer.providerGrounded, answer.providerCitations),
      providerCitations: Array.isArray(answer.providerCitations) ? answer.providerCitations : [],
      answerTextUrls: answerTextUrls(String(answer.text ?? "")),
      mentions: mentionsRes.rows,
      citations: citationsRes.rows,
      claims: claimsRes.rows,
      flags: flagsRes.rows,
      sourceDisclosure: {
        sourceType: answer.sourceType,
        disclosureNote:
          answer.sourceType === "licensed_serp"
            ? "Data collected via licensed SERP partner capturing live search engine AI surfaces. Search evidence is shown separately."
            : "Data collected via an official AI provider API. Search grounding evidence is shown separately.",
      },
    };
  }

  async compareAnswers(context: TenantContext, projectId: string, query: CompareAnswersQuery) {
    await this.assertProjectAccess(context, projectId);

    if (query.answerId1 && query.answerId2) {
      // Compare two specific answers (e.g. timeline diff ANS-FR-004)
      const a1 = await this.getAnswerById(context, projectId, query.answerId1);
      const a2 = await this.getAnswerById(context, projectId, query.answerId2);

      const entities1 = new Set(a1.mentions.map((m: { entityName: string }) => m.entityName));
      const entities2 = new Set(a2.mentions.map((m: { entityName: string }) => m.entityName));

      const sharedEntities = Array.from(entities1).filter((e) => entities2.has(e));
      const addedInAnswer2 = Array.from(entities2).filter((e) => !entities1.has(e));
      const removedInAnswer2 = Array.from(entities1).filter((e) => !entities2.has(e));

      return {
        type: "timeline_diff",
        answer1: a1,
        answer2: a2,
        diff: {
          sharedEntities,
          addedInAnswer2,
          removedInAnswer2,
          lengthChange: a2.text.length - a1.text.length,
          brandMentionedBefore: a1.mentions.some(
            (m: { entityType: string }) => m.entityType === "brand",
          ),
          brandMentionedAfter: a2.mentions.some(
            (m: { entityType: string }) => m.entityType === "brand",
          ),
        },
      };
    }

    if (query.promptId) {
      // Cross-engine comparison for a prompt (ANS-FR-005)
      const res = await this.pool.query(
        `SELECT DISTINCT ON (a.engine)
          a.id
        FROM public.answers a
        WHERE a.project_id = $1 AND a.tenant_id = $2 AND a.prompt_id = $3
        ORDER BY a.engine, a.created_at DESC`,
        [projectId, context.tenantId, query.promptId],
      );

      const answerIds: string[] = res.rows.map((r) => r.id);
      const engineAnswers = await Promise.all(
        answerIds.map((id) => this.getAnswerById(context, projectId, id)),
      );

      return {
        type: "cross_engine_compare",
        promptId: query.promptId,
        engines: engineAnswers,
      };
    }

    throw new ApiError(
      400,
      "Provide either promptId or (answerId1 and answerId2) for comparison",
      "INVALID_INPUT",
    );
  }

  async flagAnswer(
    context: TenantContext,
    projectId: string,
    answerId: string,
    input: FlagAnswerInput,
  ) {
    await this.assertProjectAccess(context, projectId);

    if (!input.reason || input.reason.trim().length === 0) {
      throw new ApiError(400, "Reason is required to flag an answer", "INVALID_INPUT");
    }

    const insertSql = `
      INSERT INTO public.answer_flags (
        tenant_id, project_id, answer_id, user_id, reason, note, tags, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
      RETURNING id, reason, note, tags, status, created_at as "createdAt"
    `;

    const res = await this.pool.query(insertSql, [
      context.tenantId,
      projectId,
      answerId,
      context.userId,
      input.reason.trim(),
      input.note?.trim() || null,
      JSON.stringify(input.tags || []),
    ]);

    // Record audit event
    await this.pool.query(
      `INSERT INTO public.monitoring_events (tenant_id, project_id, kind, details)
       VALUES ($1, $2, 'answer.flagged', $3)`,
      [
        context.tenantId,
        projectId,
        JSON.stringify({
          answerId,
          flagId: res.rows[0].id,
          reason: input.reason,
          userId: context.userId,
        }),
      ],
    );

    return res.rows[0];
  }

  async reviewMention(
    context: TenantContext,
    projectId: string,
    answerId: string,
    mentionId: string,
    reviewStatus: "verified" | "false_positive",
  ) {
    await this.assertProjectAccess(context, projectId);

    if (!["verified", "false_positive"].includes(reviewStatus)) {
      throw new ApiError(
        400,
        "Invalid reviewStatus. Must be 'verified' or 'false_positive'",
        "INVALID_INPUT",
      );
    }

    const res = await this.pool.query(
      `UPDATE public.mentions
       SET review_status = $1
       WHERE id = $2 AND answer_id = $3 AND project_id = $4 AND tenant_id = $5
       RETURNING id, entity_name as "entityName", review_status as "reviewStatus"`,
      [reviewStatus, mentionId, answerId, projectId, context.tenantId],
    );

    if (!res.rows.length) {
      throw new ApiError(404, "Mention not found", "MENTION_NOT_FOUND");
    }

    // Record event
    await this.pool.query(
      `INSERT INTO public.monitoring_events (tenant_id, project_id, kind, details)
       VALUES ($1, $2, 'mention.reviewed', $3)`,
      [
        context.tenantId,
        projectId,
        JSON.stringify({
          answerId,
          mentionId,
          reviewStatus,
          entityName: res.rows[0].entityName,
          userId: context.userId,
        }),
      ],
    );

    return res.rows[0];
  }

  private generateCsv(items: Record<string, unknown>[]): string {
    const headers = [
      "ID",
      "Brand",
      "Engine",
      "Model",
      "Geo",
      "Language",
      "Prompt",
      "Brand Mentioned",
      "Brand Sentiment",
      "Brand Position",
      "Citations Count",
      "Citation Domains",
      "Tokens Used",
      "Latency (ms)",
      "Created At",
    ];

    const escapeCsv = (str: unknown) => {
      const val = str === null || str === undefined ? "" : String(str);
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = items.map((i) => [
      i.id,
      i.brandName || "",
      i.engine,
      i.engineModel || "",
      i.geo,
      i.language,
      i.promptText || "",
      i.brandMentioned ? "Yes" : "No",
      i.brandSentiment ?? "",
      i.brandPosition ?? "",
      i.citationsCount,
      Array.isArray(i.citationDomains) ? i.citationDomains.join("; ") : "",
      i.tokensUsed ?? "",
      i.latencyMs ?? "",
      i.createdAt,
    ]);

    return [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  }
}
