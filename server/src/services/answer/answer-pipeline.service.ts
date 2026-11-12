import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { extractEntities, type EntityTarget, type ExtractedMention } from "./entity-extractor.js";
import { extractCitations, type ExtractedCitation } from "./citation-extractor.js";
import { extractBrandClaims, type ExtractedClaim } from "./claims-extractor.js";

export interface ParsedAnswerResult {
  answerId: string;
  runId: string;
  tenantId: string;
  projectId: string;
  brandMentioned: boolean;
  mentions: ExtractedMention[];
  citations: ExtractedCitation[];
  claims: ExtractedClaim[];
}

interface RunRow {
  id: string;
  tenant_id: string;
  project_id: string;
  status: string;
  request: {
    engine?: string;
    model?: string;
    promptId?: string;
    geo?: string;
    language?: string;
    collectionMethod?: string;
  };
  result: {
    text?: string;
    evidenceKey?: string;
    evidenceHash?: string;
    parserVersion?: string;
    citations?: { url: string; title?: string }[];
    searchQueries?: string[];
    latencyMs?: number;
    usage?: { totalTokens?: number };
    raw?: unknown;
  } | null;
  brand_name: string;
  domain: string;
  aliases: string[] | null;
}

interface CompetitorRow {
  id: string;
  name: string;
  domain: string;
  aliases: string[] | null;
}

/**
 * Ingests and processes a completed monitoring run into answers, mentions, citations, and claims.
 * Emits 'answer.parsed' event upon successful persistence.
 */
export async function processAnswerForRun(
  pool: Pool,
  runId: string,
): Promise<ParsedAnswerResult | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 91))", [runId]);
    const scope = await client.query("SELECT savoir_answer_scope($1) AS ready", [runId]);
    if (!scope.rows[0]?.ready) {
      await client.query("COMMIT");
      return null;
    }
    const result = await processScopedAnswer(client, runId);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function processScopedAnswer(
  client: import("pg").PoolClient,
  runId: string,
): Promise<ParsedAnswerResult | null> {
  // All operations share the transaction-local context installed above.
  // 1. Fetch run, project brand profile, and aliases
  const runQuery = `
    SELECT 
      mr.id, mr.tenant_id, mr.project_id, mr.status, mr.request, mr.result,
      p.brand_name, p.domain, p.aliases
    FROM public.monitoring_runs mr
    JOIN public.projects p ON mr.project_id = p.id
    WHERE mr.id = $1
  `;
  const runRes = await client.query<RunRow>(runQuery, [runId]);
  const run = runRes.rows[0];

  if (!run || !run.result || (run.status !== "succeeded" && run.status !== "refused")) {
    return null;
  }

  // Check if answer already parsed
  const existingAnswerRes = await client.query<{ id: string }>(
    `SELECT id FROM public.answers WHERE run_id = $1`,
    [runId],
  );
  if (existingAnswerRes.rows[0]) {
    const answerId = existingAnswerRes.rows[0].id;
    const mentionsRes = await client.query<ExtractedMention>(
      `SELECT * FROM public.mentions WHERE answer_id = $1 ORDER BY position_index ASC`,
      [answerId],
    );
    const citationsRes = await client.query<ExtractedCitation>(
      `SELECT * FROM public.citations WHERE answer_id = $1 ORDER BY order_index ASC`,
      [answerId],
    );
    const claimsRes = await client.query<ExtractedClaim>(
      `SELECT * FROM public.claims WHERE answer_id = $1`,
      [answerId],
    );
    const brandMentioned = mentionsRes.rows.some((m) => m.entityType === "brand");

    return {
      answerId,
      runId,
      tenantId: run.tenant_id,
      projectId: run.project_id,
      brandMentioned,
      mentions: mentionsRes.rows,
      citations: citationsRes.rows,
      claims: claimsRes.rows,
    };
  }

  // 2. Fetch competitors for this project
  const compQuery = `
    SELECT id, name, domain, aliases
    FROM public.competitors
    WHERE project_id = $1
  `;
  const compRes = await client.query<CompetitorRow>(compQuery, [run.project_id]);

  // 3. Build target entities
  const targets: EntityTarget[] = [
    {
      id: run.project_id,
      name: run.brand_name,
      type: "brand",
      domain: run.domain,
      aliases: Array.isArray(run.aliases) ? run.aliases : [],
    },
    ...compRes.rows.map((c) => ({
      id: c.id,
      name: c.name,
      type: "competitor" as const,
      domain: c.domain,
      aliases: Array.isArray(c.aliases) ? c.aliases : [],
    })),
  ];

  const answerText =
    run.result.text || (run.status === "refused" ? "Provider refused to respond." : "");
  const textHash = createHash("sha256").update(answerText).digest("hex");

  // 4. Run entity extraction
  const mentions = extractEntities(answerText, targets);
  const brandMentioned = mentions.some((m) => m.entityType === "brand");

  // 5. Run citation extraction & classification
  const competitorDomains = compRes.rows.map((c) => c.domain).filter(Boolean);
  const citations = extractCitations(answerText, run.result.citations || [], {
    brandDomain: run.domain,
    brandAliases: Array.isArray(run.aliases) ? run.aliases : [],
    competitorDomains,
  });

  // 6. Run brand claims extraction
  const claims = extractBrandClaims(
    answerText,
    run.brand_name,
    Array.isArray(run.aliases) ? run.aliases : [],
  );

  const engine = run.request.engine || "gemini";
  const engineModel = run.request.model || null;
  const promptId = run.request.promptId || null;
  const geo = run.request.geo || "US";
  const language = run.request.language || "en";
  const sourceType =
    run.request.collectionMethod ||
    (engine.startsWith("google_ai_") ? "licensed_serp" : "official_api");
  const refusalFlag = run.status === "refused";
  const hasCitations = citations.length > 0;
  const parserVersion = run.result.parserVersion || `${engine}-v1.0.0`;

  // 7. Persist in transaction

  // Insert answers
  const insertAnswerQuery = `
      INSERT INTO public.answers (
        tenant_id, project_id, run_id, prompt_id, engine, engine_model,
        geo, language, text, text_ref, text_hash, parser_version,
        has_citations, refusal_flag, source_type, search_queries,
        latency_ms, tokens_used, raw_response
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19
      )
      RETURNING id
    `;
  const answerRes = await client.query<{ id: string }>(insertAnswerQuery, [
    run.tenant_id,
    run.project_id,
    run.id,
    promptId,
    engine,
    engineModel,
    geo,
    language,
    answerText,
    run.result.evidenceKey || null,
    textHash,
    parserVersion,
    hasCitations,
    refusalFlag,
    sourceType,
    JSON.stringify(run.result.searchQueries || []),
    run.result.latencyMs || null,
    run.result.usage?.totalTokens || null,
    run.result.raw ? JSON.stringify(run.result.raw) : null,
  ]);

  const answerId = answerRes.rows[0].id;

  // Insert mentions
  for (const m of mentions) {
    await client.query(
      `INSERT INTO public.mentions (
          tenant_id, project_id, answer_id, entity_type, entity_id,
          entity_name, matched_text, position_index, list_rank,
          sentiment, confidence, snippet, review_status, label
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14
        )`,
      [
        run.tenant_id,
        run.project_id,
        answerId,
        m.entityType,
        m.entityId || null,
        m.entityName,
        m.matchedText,
        m.positionIndex,
        m.listRank || null,
        m.sentiment,
        m.confidence,
        m.snippet,
        m.reviewStatus,
        m.label,
      ],
    );
  }

  // Insert citations
  for (const c of citations) {
    await client.query(
      `INSERT INTO public.citations (
          tenant_id, project_id, answer_id, url, normalized_url,
          domain, source_type, anchor_text, order_index
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9
        )`,
      [
        run.tenant_id,
        run.project_id,
        answerId,
        c.url,
        c.normalizedUrl,
        c.domain,
        c.sourceType,
        c.anchorText || null,
        c.orderIndex,
      ],
    );
  }

  // Insert claims
  for (const cl of claims) {
    await client.query(
      `INSERT INTO public.claims (
          tenant_id, project_id, answer_id, entity_name, claim_text,
          theme, sentiment, confidence, label
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9
        )`,
      [
        run.tenant_id,
        run.project_id,
        answerId,
        cl.entityName,
        cl.claimText,
        cl.theme,
        cl.sentiment,
        cl.confidence,
        cl.label,
      ],
    );
  }

  await client.query("SELECT savoir_answer_parsed_event($1)", [runId]);

  return {
    answerId,
    runId: run.id,
    tenantId: run.tenant_id,
    projectId: run.project_id,
    brandMentioned,
    mentions,
    citations,
    claims,
  };
}
