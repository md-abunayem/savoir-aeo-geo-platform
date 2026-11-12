import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { withTenantClient } from "../../db/tenant.js";
import { ApiError } from "../../utils/ApiError.js";
import {
  opportunitiesQuery,
  parseQaIngestion,
  type QuestionInput,
} from "../../validations/qa.validation.js";
import {
  CONTENT_FORMATS,
  type QaClassifier,
  type QuestionIntent,
} from "./qa-classifier.service.js";

interface QuestionRow {
  id: string;
  source: QuestionInput["source"];
  questionText: string;
  intent: QuestionIntent;
  demandScore: number;
  businessPriority: number;
  status: "backlog" | "planned" | "published" | "dismissed";
  priorityScore: number;
  createdAt: Date;
}
const columns = `id, source, question_text AS "questionText", intent,
  demand_score AS "demandScore", business_priority AS "businessPriority", status,
  ((6 * demand_score + 4 * business_priority) / 10.0)::float8 AS "priorityScore",
  created_at AS "createdAt"`;
const withFormats = (row: QuestionRow) => ({
  ...row,
  recommendedFormats: CONTENT_FORMATS[row.intent],
});

export class QaService {
  constructor(
    private readonly pool: Pool,
    private readonly classifier: QaClassifier,
  ) {}

  private async context(userId: string, projectId: string) {
    const result = await this.pool.query<{ tenant_id: string | null }>(
      "SELECT savoir_project_context($1,$2) AS tenant_id",
      [z.uuid().parse(userId), z.uuid().parse(projectId)],
    );
    const tenantId = result.rows[0]?.tenant_id;
    if (!tenantId) throw new ApiError(404, "Project not found", "NOT_FOUND");
    return { userId, tenantId };
  }

  async ingest(userId: string, projectId: string, input: unknown) {
    const questions = parseQaIngestion(input);
    const context = await this.context(userId, projectId);
    const unique = new Map<string, QuestionInput & { questionHash: string; occurrences: number }>();
    for (const question of questions) {
      const normalized = question.questionText
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/gu, " ")
        .trim();
      const questionHash = createHash("sha256").update(normalized).digest("hex");
      const key = question.source + ":" + questionHash;
      const existing = unique.get(key);
      if (existing) {
        existing.occurrences++;
        existing.businessPriority = Math.max(existing.businessPriority, question.businessPriority);
        if (question.demandScore !== undefined)
          existing.demandScore = Math.max(existing.demandScore ?? 0, question.demandScore);
      } else unique.set(key, { ...question, questionHash, occurrences: 1 });
    }
    const known = await withTenantClient(this.pool, context, async (client) => {
      const result = await client.query<{ source: string; question_hash: string }>(
        `SELECT source, question_hash FROM customer_questions
         WHERE tenant_id = $1 AND project_id = $2 AND question_hash = ANY($3::text[])`,
        [context.tenantId, projectId, [...unique.values()].map((q) => q.questionHash)],
      );
      return new Set(result.rows.map((row) => row.source + ":" + row.question_hash));
    });
    const pending = [...unique.entries()]
      .filter(([key]) => !known.has(key))
      .map(([, value]) => value);
    if (!pending.length)
      return {
        received: questions.length,
        imported: 0,
        duplicates: questions.length,
        questions: [],
      };
    // Finish classification before starting the write transaction: a failed batch writes nothing.
    const classified = await this.classifier.classify(pending.map((q) => q.questionText));
    if (
      classified.length !== pending.length ||
      classified.some((q) => !(q.intent in CONTENT_FORMATS))
    ) {
      throw new ApiError(502, "Invalid question classifications", "QA_CLASSIFICATION_FAILED");
    }
    const records = pending.map((q, index) => ({
      source: q.source,
      question_text: q.questionText,
      question_hash: q.questionHash,
      intent: classified[index]!.intent,
      demand_score: q.demandScore ?? Math.min(q.occurrences, 100),
      business_priority: q.businessPriority,
    }));
    const imported = await withTenantClient(this.pool, context, async (client) => {
      const result = await client.query<QuestionRow>(
        `INSERT INTO customer_questions
          (tenant_id, project_id, source, question_text, question_hash, intent, demand_score, business_priority)
         SELECT $1::uuid, $2::uuid, r.source::question_source, r.question_text, r.question_hash,
           r.intent::question_intent, r.demand_score, r.business_priority
         FROM jsonb_to_recordset($3::jsonb) AS r(source text, question_text text, question_hash text,
           intent text, demand_score integer, business_priority integer)
         WHERE true
         ON CONFLICT (project_id, source, question_hash) DO NOTHING
         RETURNING ${columns}`,
        [context.tenantId, projectId, JSON.stringify(records)],
      );
      return result.rows.map(withFormats);
    });
    return {
      received: questions.length,
      imported: imported.length,
      duplicates: questions.length - imported.length,
      questions: imported,
    };
  }

  async opportunities(userId: string, projectId: string, input: unknown) {
    const query = opportunitiesQuery.parse(input);
    const context = await this.context(userId, projectId);
    return withTenantClient(this.pool, context, async (client) => {
      const result = await client.query<QuestionRow>(
        `SELECT ${columns} FROM customer_questions
         WHERE tenant_id = $1 AND project_id = $2 AND status = $3::question_status
           AND ($4::question_intent IS NULL OR intent = $4::question_intent)
           AND ($5::question_source IS NULL OR source = $5::question_source)
         ORDER BY "priorityScore" DESC, demand_score DESC, created_at ASC, id ASC
         LIMIT $6 OFFSET $7`,
        [
          context.tenantId,
          projectId,
          query.status,
          query.intent ?? null,
          query.source ?? null,
          query.limit + 1,
          query.offset,
        ],
      );
      return {
        questions: result.rows.slice(0, query.limit).map(withFormats),
        nextOffset: result.rows.length > query.limit ? query.offset + query.limit : null,
      };
    });
  }
}
