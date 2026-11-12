import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { withTenant, type TenantContext } from "../../db/tenant.js";
import { ApiError } from "../../utils/ApiError.js";
import {
  promptInput,
  promptImportInput,
  promptBulkInput,
  promptPatch,
  promptListInput,
  runInput,
  scheduleInput,
  scheduleStatus,
  listRunsInput,
  idempotencyKey,
  boundBatch,
} from "../../validations/monitoring.validation.js";
import { MonitoringProviderError, type EvidenceStore, type MonitoringEngineType } from "./types.js";
import type { MultiEngineProvider } from "./multi-engine.provider.js";

export interface MonitoringEngineConfig {
  enabled: boolean;
  model: string;
}

export interface MonitoringServiceConfig {
  wakeQueue?: () => Promise<void>;
  model: string;
  enabled: boolean;
  gemini?: MonitoringEngineConfig;
  openrouter?: MonitoringEngineConfig;
  openai?: MonitoringEngineConfig;
  serp?: {
    enabled: boolean;
    model?: string;
    baseUrl?: string;
  };
}

export function createMonitoringService(
  pool: Pool,
  storage: EvidenceStore,
  config: MonitoringServiceConfig,
  provider?: MultiEngineProvider,
) {
  async function wakeQueue() {
    try {
      await config.wakeQueue?.();
    } catch {
      /* The committed PostgreSQL outbox is reconciled by the periodic dispatcher. */
    }
  }
  async function scoped<T>(
    context: TenantContext,
    projectId: string,
    work: Parameters<typeof withTenant<T>>[2],
  ): Promise<T> {
    return withTenant(pool, context, async (db) => {
      const p = await db.execute(sql`SELECT id FROM projects WHERE id=${projectId}::uuid`);
      if (!p.rows[0]) throw new ApiError(404, "Resource not found", "NOT_FOUND");
      return work(db);
    });
  }
  async function command(context: TenantContext, projectId: string, action: string, data: unknown) {
    try {
      return await scoped(context, projectId, async (db) => {
        const r = await db.execute(
          sql`SELECT savoir_monitoring_command(${projectId}::uuid,${action},${JSON.stringify(data)}::jsonb) AS data`,
        );
        return r.rows[0]?.data as Record<string, unknown>;
      });
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      const code = e.cause?.code ?? e.code;
      if (code === "P0002") throw new ApiError(404, "Resource not found", "NOT_FOUND");
      if (code === "23505")
        throw new ApiError(
          409,
          "Idempotency key already used for different inputs",
          "IDEMPOTENCY_CONFLICT",
        );
      throw error;
    }
  }
  const enabled = () => {
    if (!config.enabled)
      throw new ApiError(503, "Monitoring execution is disabled", "MONITORING_DISABLED");
  };
  const batch = (v: Parameters<typeof boundBatch>[0]) => {
    try {
      boundBatch(v);
    } catch {
      throw new ApiError(400, "At most 500 runs per batch", "BATCH_TOO_LARGE");
    }
  };
  function accepted(result: Record<string, unknown>) {
    if (result.accepted === false)
      throw new ApiError(
        result.reason === "QUOTA_EXHAUSTED" || result.reason === "QUOTA_NOT_CONFIGURED" ? 402 : 409,
        "Monitoring request cannot run: " + String(result.reason),
        String(result.reason),
      );
    return result;
  }
  const engineConfigurations = () => [
    {
      engine: "openrouter" as const,
      configured: Boolean(config.openrouter?.enabled),
      model: config.openrouter?.model ?? "openai/gpt-6-luna",
      collectionMethod: "aggregator_api" as const,
      simulationMethod: "prompt_context" as const,
    },
    {
      engine: "gemini" as const,
      configured: Boolean(config.gemini ? config.gemini.enabled : config.enabled),
      model: config.gemini?.model ?? config.model,
      collectionMethod: "official_api" as const,
      simulationMethod: "prompt_context" as const,
    },
    {
      engine: "openai" as const,
      configured: Boolean(config.openai?.enabled),
      model: config.openai?.model ?? "gpt-4o",
      collectionMethod: "official_api" as const,
      simulationMethod: "prompt_context" as const,
    },
    {
      engine: "google_ai_overviews" as const,
      configured: Boolean(config.serp?.enabled),
      model: config.serp?.model ?? "google-ai-overview-surface",
      collectionMethod: "licensed_serp" as const,
      simulationMethod: "prompt_context" as const,
    },
    {
      engine: "google_ai_mode" as const,
      configured: false,
      model: config.serp?.model ?? "google-ai-mode-surface",
      collectionMethod: "licensed_serp" as const,
      simulationMethod: "prompt_context" as const,
    },
  ];
  return {
    async engines(c: TenantContext, p: string) {
      return scoped(c, p, async (db) => {
        const observations = await db.execute(sql`
          SELECT DISTINCT ON (coalesce(request->>'engine','gemini'))
            coalesce(request->>'engine','gemini') AS engine,
            request->>'model' AS requested_model,
            result->>'modelVersion' AS observed_model,
            status,
            error_code,
            completed_at
          FROM monitoring_runs
          WHERE project_id=${p}::uuid
            AND status IN ('succeeded','refused','failed','uncertain')
          ORDER BY coalesce(request->>'engine','gemini'), completed_at DESC NULLS LAST, created_at DESC
        `);
        const byEngine = new Map(observations.rows.map((row) => [row.engine as string, row]));
        return engineConfigurations().map((engine) => {
          const observed = byEngine.get(engine.engine);
          return {
            ...engine,
            observationStatus: observed?.status ?? null,
            observedStatus: observed?.status ?? null,
            observedAt: observed?.completed_at ?? null,
            observedModel: observed?.observed_model ?? observed?.requested_model ?? null,
            errorCode: observed?.error_code ?? null,
          };
        });
      });
    },
    async createPrompt(c: TenantContext, p: string, input: unknown, requestKey?: string) {
      const value = promptInput.parse(input);
      if (requestKey === undefined) return command(c, p, "prompt.create", value);
      const key = idempotencyKey.parse(requestKey);
      return scoped(c, p, async (db) => {
        // Serialize identical requests before checking/inserting; creation and
        // its receipt commit together, including across concurrent API workers.
        await db.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${p}:${c.userId}:${key}`},0))`,
        );
        const existing = await db.execute(sql`
          SELECT result, input = ${JSON.stringify(value)}::jsonb AS matches
          FROM monitoring_prompt_requests
          WHERE project_id=${p}::uuid AND user_id=${c.userId}::uuid AND request_key=${key}
        `);
        if (existing.rows[0]) {
          if (!existing.rows[0].matches)
            throw new ApiError(
              409,
              "Idempotency key already used for different inputs",
              "IDEMPOTENCY_CONFLICT",
            );
          return existing.rows[0].result as Record<string, unknown>;
        }
        const created = await db.execute(sql`
          SELECT savoir_monitoring_command(${p}::uuid,'prompt.create',${JSON.stringify(value)}::jsonb) AS data
        `);
        const result = created.rows[0].data as Record<string, unknown>;
        await db.execute(sql`
          INSERT INTO monitoring_prompt_requests(project_id,tenant_id,user_id,request_key,input,result)
          VALUES(${p}::uuid,${c.tenantId}::uuid,${c.userId}::uuid,${key},${JSON.stringify(value)}::jsonb,${JSON.stringify(result)}::jsonb)
        `);
        return result;
      });
    },
    async importPrompts(c: TenantContext, p: string, input: unknown, requestKey: string) {
      const value = promptImportInput.parse(input);
      const key = idempotencyKey.parse(requestKey);
      return scoped(c, p, async (db) => {
        await db.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`prompt-import:${p}:${c.userId}:${key}`},0))`,
        );
        const existing = await db.execute(sql`
          SELECT result, input = ${JSON.stringify(value)}::jsonb AS matches
          FROM monitoring_prompt_requests
          WHERE project_id=${p}::uuid AND user_id=${c.userId}::uuid AND request_key=${key}
        `);
        if (existing.rows[0]) {
          if (!existing.rows[0].matches)
            throw new ApiError(
              409,
              "Idempotency key already used for different inputs",
              "IDEMPOTENCY_CONFLICT",
            );
          return existing.rows[0].result;
        }
        const imported = await db.execute(sql`
          SELECT savoir_monitoring_command(${p}::uuid,'prompt.import',${JSON.stringify(value)}::jsonb) AS data
        `);
        const result = imported.rows[0]?.data;
        await db.execute(sql`
          INSERT INTO monitoring_prompt_requests(project_id,tenant_id,user_id,request_key,input,result)
          VALUES(${p}::uuid,${c.tenantId}::uuid,${c.userId}::uuid,${key},${JSON.stringify(value)}::jsonb,${JSON.stringify(result)}::jsonb)
        `);
        return result;
      });
    },
    bulkPrompts: (c: TenantContext, p: string, input: unknown) =>
      command(c, p, "prompt.bulk", promptBulkInput.parse(input)),
    updatePrompt: (c: TenantContext, p: string, id: string, input: unknown) =>
      command(c, p, "prompt.update", { ...promptPatch.parse(input), id }),
    stopQuotaRetries: (c: TenantContext, p: string) =>
      scoped(c, p, async (db) => {
        const result = await db.execute(
          sql`SELECT savoir_monitoring_stop_quota_retries(${p}::uuid) AS stopped`,
        );
        return { stopped: Number(result.rows[0]?.stopped ?? 0) };
      }),
    async run(c: TenantContext, p: string, key: string, input: unknown) {
      enabled();
      const v = runInput.parse(input);
      batch(v);
      const allEngines = engineConfigurations();
      const meta = allEngines.find((e) => e.engine === v.engine);
      if (!meta || !meta.configured) {
        throw new ApiError(
          503,
          `Monitoring for engine '${v.engine}' is not configured or disabled`,
          "ENGINE_NOT_CONFIGURED",
        );
      }
      const result = accepted(
        await command(c, p, "run", {
          key: idempotencyKey.parse(key),
          config: { ...v, model: meta.model },
        }),
      );
      await wakeQueue();
      return result;
    },
    async createSchedule(c: TenantContext, p: string, input: unknown, requestKey?: string) {
      const v = scheduleInput.parse(input);
      batch(v);
      const intervalMinutes =
        v.cadence === "daily" ? 1440 : v.cadence === "weekly" ? 10080 : v.intervalMinutes;
      function scheduleConfig() {
        const meta = engineConfigurations().find((e) => e.engine === v.engine);
        if (!meta?.configured)
          throw new ApiError(
            503,
            `Monitoring for engine '${v.engine}' is not configured or disabled`,
            "ENGINE_NOT_CONFIGURED",
          );
        return { ...v, intervalMinutes, model: meta.model };
      }
      if (requestKey === undefined) {
        const result = accepted(await command(c, p, "schedule.create", scheduleConfig()));
        await wakeQueue();
        return result;
      }
      const key = idempotencyKey.parse(requestKey);
      const result = await scoped(c, p, async (db) => {
        await db.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${p}:${c.userId}:${key}`},0))`,
        );
        const prior = await db.execute(sql`
          SELECT result,input=${JSON.stringify(v)}::jsonb AS matches FROM monitoring_schedule_requests
          WHERE project_id=${p}::uuid AND user_id=${c.userId}::uuid AND request_key=${key}
        `);
        if (prior.rows[0]) {
          if (!prior.rows[0].matches)
            throw new ApiError(
              409,
              "Idempotency key already used for different inputs",
              "IDEMPOTENCY_CONFLICT",
            );
          return prior.rows[0].result as Record<string, unknown>;
        }
        const created = await db.execute(sql`
          SELECT savoir_monitoring_command(${p}::uuid,'schedule.create',${JSON.stringify(scheduleConfig())}::jsonb) AS data
        `);
        const result = accepted(created.rows[0].data as Record<string, unknown>);
        await db.execute(sql`
          INSERT INTO monitoring_schedule_requests(project_id,tenant_id,user_id,request_key,input,result)
          VALUES(${p}::uuid,${c.tenantId}::uuid,${c.userId}::uuid,${key},${JSON.stringify(v)}::jsonb,${JSON.stringify(result)}::jsonb)
        `);
        return result;
      });
      await wakeQueue();
      return result;
    },
    async canary(c: TenantContext, p: string, engine: MonitoringEngineType, keyInput: string) {
      enabled();
      const key = idempotencyKey.parse(keyInput);
      const reservation = await scoped(c, p, async (db) => {
        if (!provider) {
          throw new ApiError(503, "Canary testing provider unavailable", "CANARY_UNAVAILABLE");
        }
        const meta = engineConfigurations().find((e) => e.engine === engine);
        if (!meta || !meta.configured) {
          throw new ApiError(503, `Engine '${engine}' is not configured`, "ENGINE_NOT_CONFIGURED");
        }
        const testedAt = new Date().toISOString();
        // Commit an uncertain outcome BEFORE making a potentially billable request.
        // A concurrent request or a retry after a crash must never repeat that call.
        const pending = {
          status: "uncertain",
          generationStatus: null,
          engine,
          model: meta.model,
          modelVersion: null,
          latencyMs: null,
          groundingObserved: false,
          citationsCount: 0,
          testedAt,
          errorCode: "CONNECTION_TEST_UNCONFIRMED",
          platformCreditsApplied: false,
        };
        const inserted = await db.execute(sql`
          INSERT INTO monitoring_connection_tests(project_id,tenant_id,request_key,engine,result)
          VALUES(${p}::uuid,${c.tenantId}::uuid,${key},${engine},${JSON.stringify(pending)}::jsonb)
          ON CONFLICT(project_id,request_key) DO NOTHING RETURNING request_key
        `);
        if (!inserted.rows.length) {
          const prior = await db.execute(sql`
            SELECT engine,result FROM monitoring_connection_tests
            WHERE project_id=${p}::uuid AND request_key=${key}
          `);
          if (prior.rows[0]?.engine !== engine)
            throw new ApiError(
              409,
              "Connection test key already used for a different engine",
              "IDEMPOTENCY_CONFLICT",
            );
          return {
            execute: false as const,
            result: prior.rows[0].result as Record<string, unknown>,
          };
        }
        return { execute: true as const, model: meta.model, testedAt };
      });
      if (!reservation.execute) return reservation.result;
      const startedAt = Date.now();
      const { model, testedAt } = reservation;
      const execute = async () => {
        try {
          const result = await provider!.canaryTest(engine, model);
          return {
            status: result.status === "succeeded" ? "succeeded" : "failed",
            generationStatus: result.status,
            engine,
            model,
            modelVersion: result.modelVersion,
            latencyMs: result.latencyMs,
            groundingObserved: result.grounded && result.citations.length > 0,
            citationsCount: result.citations.length,
            testedAt,
            platformCreditsApplied: false,
          };
        } catch (err) {
          const known = err instanceof MonitoringProviderError;
          return {
            status: known && err.uncertain ? "uncertain" : "failed",
            generationStatus: null,
            engine,
            model,
            modelVersion: null,
            latencyMs: Date.now() - startedAt,
            groundingObserved: false,
            citationsCount: 0,
            testedAt,
            errorCode: known ? err.code : "PROVIDER_UNEXPECTED",
            errorCategory: known ? err.category : "PROVIDER_UNAVAILABLE",
            errorMessage: known ? err.message : "Unexpected provider execution failure.",
            httpStatus: known ? err.httpStatus : null,
            retryable: known && err.retryable,
            platformCreditsApplied: false,
          };
        }
      };
      const result = await execute();
      await scoped(c, p, async (db) => {
        await db.execute(sql`
          UPDATE monitoring_connection_tests SET result=${JSON.stringify(result)}::jsonb
          WHERE project_id=${p}::uuid AND request_key=${key}
        `);
      });
      return result;
    },
    scheduleStatus: (c: TenantContext, p: string, id: string, input: unknown) =>
      command(c, p, "schedule.status", { ...scheduleStatus.parse(input), id }),
    promptScheduleStatus: (c: TenantContext, p: string, id: string, input: unknown) =>
      command(c, p, "prompt.schedule.status", { ...scheduleStatus.parse(input), id }),
    allScheduleStatus: (c: TenantContext, p: string, input: unknown) =>
      command(c, p, "schedule.status", scheduleStatus.parse(input)),
    async list(
      c: TenantContext,
      p: string,
      kind: "prompts" | "schedules" | "events" | "runs",
      input: unknown = {},
    ) {
      const promptQuery = kind === "prompts" ? promptListInput.parse(input) : null;
      const { limit, before } = promptQuery ?? listRunsInput.parse(input);
      return scoped(c, p, async (db) => {
        const table = {
          prompts: "monitoring_prompts",
          schedules: "monitoring_schedules",
          events: "monitoring_events",
          runs: "monitoring_runs",
        }[kind];
        const tableSql = sql.identifier(table);
        if (kind === "runs") {
          return (
            await db.execute(
              sql`SELECT r.*, EXISTS(SELECT 1 FROM answers a WHERE a.run_id=r.id) AS answer_processed FROM monitoring_runs r WHERE r.project_id=${p}::uuid ${before ? sql`AND (r.created_at,r.id)<(SELECT created_at,id FROM monitoring_runs WHERE id=${before}::uuid AND project_id=${p}::uuid)` : sql``} ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit}`,
            )
          ).rows;
        }
        if (kind === "prompts") {
          return (
            await db.execute(sql`
              SELECT mp.*,
                metrics.visibility,
                metrics.cited_count,
                metrics.answer_count,
                metrics.engines
              FROM monitoring_prompts mp
              LEFT JOIN (
                SELECT
                  coalesce(a.prompt_id,(r.request->>'promptId')::uuid) AS prompt_id,
                  round(
                    100.0 * count(DISTINCT r.id) FILTER (WHERE EXISTS (
                      SELECT 1 FROM mentions m
                      WHERE m.answer_id=a.id AND m.entity_type='brand'
                    )) / nullif(count(DISTINCT r.id),0),
                    1
                  )::float8 AS visibility,
                  count(DISTINCT c.id)::int AS cited_count,
                  count(DISTINCT r.id)::int AS answer_count,
                  coalesce(
                    array_agg(DISTINCT coalesce(a.engine,r.request->>'engine','gemini'))
                      FILTER (WHERE a.id IS NOT NULL),
                    ARRAY[]::text[]
                  ) AS engines
                FROM monitoring_runs r
                LEFT JOIN answers a ON a.run_id=r.id
                LEFT JOIN citations c ON c.answer_id=a.id
                WHERE r.project_id=${p}::uuid
                  AND r.status IN ('succeeded','refused')
                GROUP BY coalesce(a.prompt_id,(r.request->>'promptId')::uuid)
              ) metrics ON metrics.prompt_id=mp.id
              WHERE mp.project_id=${p}::uuid
                ${promptQuery?.includeArchived !== "true" ? sql`AND mp.archived_at IS NULL` : sql``}
                ${before ? sql`AND (mp.created_at,mp.id)<(SELECT created_at,id FROM monitoring_prompts WHERE id=${before}::uuid AND project_id=${p}::uuid)` : sql``}
              ORDER BY mp.created_at DESC,mp.id DESC
              LIMIT ${limit}
            `)
          ).rows;
        }
        return (
          await db.execute(
            sql`SELECT * FROM ${tableSql} WHERE project_id=${p}::uuid ${kind === "schedules" ? sql`AND status<>'deleted'` : sql``} ${before ? sql`AND (created_at,id)<(SELECT created_at,id FROM ${tableSql} WHERE id=${before}::uuid AND project_id=${p}::uuid)` : sql``} ORDER BY created_at DESC,id DESC LIMIT ${limit}`,
          )
        ).rows;
      });
    },
    async promptSummary(c: TenantContext, p: string) {
      return scoped(c, p, async (db) => {
        const result = await db.execute(sql`
          WITH prompt_visibility AS (
            SELECT
              coalesce(a.prompt_id,(r.request->>'promptId')::uuid) AS prompt_id,
              count(DISTINCT r.id) AS total,
              count(DISTINCT r.id) FILTER (WHERE EXISTS (
                SELECT 1 FROM mentions m
                WHERE m.answer_id=a.id AND m.entity_type='brand'
              )) AS mentioned
            FROM monitoring_runs r
            LEFT JOIN answers a ON a.run_id=r.id
            WHERE r.project_id=${p}::uuid
              AND r.status IN ('succeeded','refused')
              AND coalesce(a.prompt_id,(r.request->>'promptId')::uuid) IS NOT NULL
            GROUP BY coalesce(a.prompt_id,(r.request->>'promptId')::uuid)
          )
          SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE active AND archived_at IS NULL)::int AS active,
            count(*) FILTER (WHERE NOT active AND archived_at IS NULL)::int AS paused,
            count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
            (SELECT count(*)::int FROM answers WHERE project_id=${p}::uuid AND created_at >= now() - interval '30 days') AS answers_30d,
            (SELECT round(avg(100.0 * mentioned / nullif(total,0)),1)::float8
             FROM prompt_visibility WHERE total > 0) AS avg_visibility
          FROM monitoring_prompts
          WHERE project_id=${p}::uuid
        `);
        return result.rows[0];
      });
    },
    async promptSuggestions(c: TenantContext, p: string) {
      return scoped(c, p, async (db) => {
        const result = await db.execute(sql`
          SELECT brand_name, domain,
            ARRAY(SELECT lower(body) FROM monitoring_prompts WHERE project_id=${p}::uuid AND archived_at IS NULL) AS existing
          FROM projects WHERE id=${p}::uuid
        `);
        const row = result.rows[0] as
          { brand_name: string; domain: string; existing: string[] } | undefined;
        if (!row) throw new ApiError(404, "Resource not found", "NOT_FOUND");
        const brand = String(row.brand_name);
        const domain = String(row.domain);
        const suggestions = [
          `What should buyers look for when choosing a provider in ${domain}?`,
          `How does ${brand} compare with other options in ${domain}?`,
          `Which ${domain} solutions are best for a growing business?`,
          `What are the most trusted alternatives to ${brand}?`,
          `What questions should a first-time buyer ask about ${domain}?`,
        ]
          .filter((body) => !row.existing.includes(body.toLowerCase()))
          .map((body) => ({ body, persona: "", tags: ["Suggested"] }));
        return { source: "local", billable: false, suggestions };
      });
    },
    async promptVersions(c: TenantContext, p: string, id: string) {
      return scoped(c, p, async (db) => {
        const prompt = await db.execute(
          sql`SELECT id FROM monitoring_prompts WHERE id=${id}::uuid AND project_id=${p}::uuid`,
        );
        if (!prompt.rows[0]) throw new ApiError(404, "Resource not found", "NOT_FOUND");
        return (
          await db.execute(sql`
            SELECT version, body, persona, created_at
            FROM monitoring_prompt_versions
            WHERE project_id=${p}::uuid AND prompt_id=${id}::uuid
            ORDER BY version DESC
          `)
        ).rows;
      });
    },
    async promptAnswers(c: TenantContext, p: string, id: string) {
      return scoped(c, p, async (db) => {
        const prompt = await db.execute(
          sql`SELECT id FROM monitoring_prompts WHERE id=${id}::uuid AND project_id=${p}::uuid`,
        );
        if (!prompt.rows[0]) throw new ApiError(404, "Resource not found", "NOT_FOUND");
        return (
          await db.execute(sql`
            SELECT a.id, a.engine, a.geo, a.language, a.text, a.created_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'url', c.url, 'domain', c.domain, 'sourceType', c.source_type
                ) ORDER BY c.order_index)
                FROM citations c WHERE c.answer_id=a.id
              ), '[]'::json) AS sources
            FROM answers a
            WHERE a.project_id=${p}::uuid AND a.prompt_id=${id}::uuid
            ORDER BY a.created_at DESC
            LIMIT 10
          `)
        ).rows;
      });
    },
    async detail(c: TenantContext, p: string, id: string) {
      return scoped(c, p, async (db) => {
        const r = await db.execute(
          sql`SELECT r.*, EXISTS(SELECT 1 FROM answers a WHERE a.run_id=r.id) AS answer_processed FROM monitoring_runs r WHERE r.id=${id}::uuid AND r.project_id=${p}::uuid`,
        );
        if (!r.rows[0]) throw new ApiError(404, "Resource not found", "NOT_FOUND");
        return r.rows[0];
      });
    },
    async evidence(c: TenantContext, p: string, id: string) {
      const row = await this.detail(c, p, id);
      const result = row.result as { evidenceKey?: string } | null;
      if (!result?.evidenceKey) throw new ApiError(404, "Evidence unavailable", "NOT_FOUND");
      if (!result.evidenceKey.startsWith(`monitoring/${c.tenantId}/${p}/${id}/`))
        throw new ApiError(500, "Invalid evidence reference");
      return JSON.parse(await storage.get(result.evidenceKey)) as unknown;
    },
    async health(c: TenantContext, p: string) {
      return scoped(c, p, async (db) => {
        const stats = await db.execute(
          sql`SELECT count(*) FILTER(WHERE status IN ('queued','processing'))::int AS backlog,count(*) FILTER(WHERE status IN ('succeeded','refused'))::int AS credits_used, max(completed_at) FILTER(WHERE status IN ('succeeded','refused')) AS last_successful_run, count(*) FILTER(WHERE status IN ('succeeded','refused') AND created_at>now()-interval '7 days')::float / nullif(count(*) FILTER(WHERE status IN ('succeeded','refused','failed','uncertain') AND created_at>now()-interval '7 days'),0) AS success_rate_7d FROM monitoring_runs WHERE project_id=${p}::uuid`,
        );
        const credits = await db.execute(
          sql`SELECT available,reserved,used,minimum_interval_minutes FROM monitoring_credits WHERE tenant_id=${c.tenantId}::uuid`,
        );
        return {
          engine: "gemini",
          ...stats.rows[0],
          backlog: Number(stats.rows[0]?.backlog ?? 0),
          credits: credits.rows[0] ?? null,
          windowDays: 7,
        };
      });
    },
  };
}
export type MonitoringService = ReturnType<typeof createMonitoringService>;
