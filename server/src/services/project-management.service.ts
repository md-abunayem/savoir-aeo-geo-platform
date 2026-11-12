import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withTenantClient } from "../db/tenant.js";
import { ApiError } from "../utils/ApiError.js";
import { validateDomainSecurity } from "./domain-security.service.js";
import { TechnicalAuditService } from "./technical/technical-audit.service.js";
import {
  createProjectInput,
  updateProjectInput,
  launchProjectInput,
  projectRequestKey,
} from "../validations/project-management.validation.js";

export interface ProjectManagementOptions {
  engines: Array<{
    engine: string;
    name: string;
    model: string;
    configured: boolean;
    requiresGrounding: boolean;
  }>;
  firecrawlConfigured: boolean;
  dailyCallLimit: number;
  allowLocalTest?: boolean;
}
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createProjectManagementService(
  pool: Pool,
  technical: TechnicalAuditService,
  options: ProjectManagementOptions,
) {
  async function context(userId: string, projectId: string) {
    const r = await pool.query("SELECT savoir_project_context($1,$2) AS tenant_id", [
      z.uuid().parse(userId),
      z.uuid().parse(projectId),
    ]);
    if (!r.rows[0]?.tenant_id) throw new ApiError(404, "Project not found", "NOT_FOUND");
    return { userId, tenantId: r.rows[0].tenant_id as string };
  }
  async function command(client: PoolClient, projectId: string, action: string, data: unknown) {
    const r = await client.query("SELECT savoir_monitoring_command($1,$2,$3) AS result", [
      projectId,
      action,
      JSON.stringify(data),
    ]);
    const result = r.rows[0].result as Record<string, unknown>;
    if (result.accepted === false)
      throw new ApiError(
        409,
        `Monitoring could not start: ${result.reason}`,
        String(result.reason),
      );
    return result;
  }
  return {
    async summaries(userId: string) {
      const owned = (await pool.query("SELECT * FROM savoir_owned_projects($1,NULL,100)", [userId]))
        .rows;
      const summaries: Record<
        string,
        { lastRunAt: string | null; lastAuditStatus: string | null; lastAuditScore: number | null }
      > = {};
      for (const tenantId of new Set(owned.map((p) => String(p.tenant_id)))) {
        await withTenantClient(pool, { userId, tenantId }, async (client) => {
          const ids = owned.filter((p) => p.tenant_id === tenantId).map((p) => p.id);
          const rows = (
            await client.query(
              `SELECT p.id,
            (SELECT max(completed_at) FROM monitoring_runs r WHERE r.project_id=p.id AND r.status='succeeded') AS last_run_at,
            (SELECT status FROM technical_audits a WHERE a.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS audit_status,
            (SELECT overall_score FROM technical_audits a WHERE a.project_id=p.id AND status='completed' ORDER BY created_at DESC LIMIT 1) AS audit_score
            FROM projects p WHERE p.id=ANY($1::uuid[])`,
              [ids],
            )
          ).rows;
          for (const r of rows)
            summaries[r.id] = {
              lastRunAt: r.last_run_at?.toISOString() ?? null,
              lastAuditStatus: r.audit_status ?? null,
              lastAuditScore: r.audit_score ?? null,
            };
        });
      }
      return summaries;
    },
    connections() {
      return {
        engines: options.engines,
        firecrawl: { configured: options.firecrawlConfigured },
        dailyCallLimit: options.dailyCallLimit,
        note: "Configured means credentials are present, not that provider quota has been verified. Gemini Search grounding and Google AI Mode use separate provider paths.",
      };
    },
    async create(userId: string, keyInput: unknown, input: unknown) {
      const key = projectRequestKey.parse(keyInput);
      const value = createProjectInput.parse(input);
      value.domain = (
        await validateDomainSecurity(value.domain, { allowLocalTest: options.allowLocalTest })
      ).normalizedDomain;
      for (const competitor of value.competitors)
        competitor.domain = (
          await validateDomainSecurity(competitor.domain, {
            allowLocalTest: options.allowLocalTest,
          })
        ).normalizedDomain;
      try {
        const r = await pool.query("SELECT * FROM savoir_create_project($1,$2,$3,$4)", [
          userId,
          key,
          fingerprint(value),
          JSON.stringify(value),
        ]);
        return {
          projectId: r.rows[0].project_id as string,
          tenantId: r.rows[0].tenant_id as string,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "PROJECT_DOMAIN_EXISTS")
          throw new ApiError(
            409,
            "You already have a project for this domain. Open it from Projects.",
            message,
          );
        if (message === "IDEMPOTENCY_CONFLICT")
          throw new ApiError(
            409,
            "This save request has already been used with different settings.",
            message,
          );
        throw error;
      }
    },
    async detail(userId: string, projectId: string) {
      const c = await context(userId, projectId);
      return withTenantClient(pool, c, async (client) => {
        const p = (
          await client.query(
            "SELECT id,tenant_id,brand_name,domain,description,aliases,default_markets,status FROM projects WHERE id=$1",
            [projectId],
          )
        ).rows[0];
        if (!p) throw new ApiError(404, "Project not found", "NOT_FOUND");
        const competitors = (
          await client.query(
            "SELECT id,name,domain,aliases,rationale FROM competitors WHERE project_id=$1 ORDER BY created_at,id",
            [projectId],
          )
        ).rows;
        const prompts = (
          await client.query(
            "SELECT id,body,active FROM monitoring_prompts WHERE project_id=$1 ORDER BY created_at,id",
            [projectId],
          )
        ).rows;
        const schedules = (
          await client.query(
            "SELECT id,status,config,next_run_at FROM monitoring_schedules WHERE project_id=$1 AND status<>'deleted' ORDER BY created_at DESC",
            [projectId],
          )
        ).rows;
        const runs = (
          await client.query(
            `SELECT r.id,r.status,r.request,r.error_code,r.created_at,r.completed_at,
              r.available_at,r.attempts,
              EXISTS(SELECT 1 FROM answers a WHERE a.run_id=r.id) AS answer_processed
             FROM monitoring_runs r WHERE r.project_id=$1 ORDER BY r.created_at DESC LIMIT 25`,
            [projectId],
          )
        ).rows;
        const counts = (
          await client.query(
            "SELECT count(*) FILTER(WHERE status IN ('queued','processing'))::int AS pending,count(*) FILTER(WHERE status='succeeded')::int AS succeeded,count(*) FILTER(WHERE status IN ('failed','uncertain'))::int AS failed FROM monitoring_runs WHERE project_id=$1",
            [projectId],
          )
        ).rows[0];
        const answers = (
          await client.query("SELECT count(*)::int AS count FROM answers WHERE project_id=$1", [
            projectId,
          ])
        ).rows[0].count;
        const audit =
          (
            await client.query(
              "SELECT id,status,pages_crawled,pages_limit,overall_score,error_message,created_at FROM technical_audits WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
              [projectId],
            )
          ).rows[0] ?? null;
        const credits =
          (
            await client.query(
              "SELECT available,reserved,used FROM monitoring_credits WHERE tenant_id=$1",
              [c.tenantId],
            )
          ).rows[0] ?? null;
        const launch =
          (
            await client.query(
              "SELECT result FROM project_launch_requests WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
              [projectId],
            )
          ).rows[0]?.result ?? null;
        return {
          project: {
            id: p.id,
            tenantId: p.tenant_id,
            brandName: p.brand_name,
            domain: p.domain,
            description: p.description ?? "",
            aliases: p.aliases ?? [],
            markets: p.default_markets ?? [{ country: "US", language: "en" }],
            status: p.status,
          },
          competitors,
          prompts,
          schedules,
          runs,
          counts,
          answers,
          audit,
          credits,
          launch,
        };
      });
    },
    async update(userId: string, projectId: string, input: unknown) {
      const c = await context(userId, projectId);
      const value = updateProjectInput.parse(input);
      for (const competitor of value.competitors)
        competitor.domain = (
          await validateDomainSecurity(competitor.domain, {
            allowLocalTest: options.allowLocalTest,
          })
        ).normalizedDomain;
      await withTenantClient(pool, c, async (client) => {
        await client.query(
          "UPDATE projects SET brand_name=$2,description=$3,aliases=$4,default_markets=$5 WHERE id=$1",
          [
            projectId,
            value.brandName,
            value.description,
            JSON.stringify(value.aliases),
            JSON.stringify(value.markets),
          ],
        );
        const kept: string[] = [];
        for (const comp of value.competitors) {
          if (comp.id) {
            const r = await client.query(
              "UPDATE competitors SET name=$3,domain=$4,aliases=$5,rationale=$6 WHERE id=$1 AND project_id=$2 RETURNING id",
              [
                comp.id,
                projectId,
                comp.name,
                comp.domain,
                JSON.stringify(comp.aliases),
                comp.rationale ?? null,
              ],
            );
            if (!r.rowCount) throw new ApiError(404, "Competitor not found", "NOT_FOUND");
            kept.push(comp.id);
          } else {
            const r = await client.query(
              "INSERT INTO competitors(tenant_id,project_id,name,domain,aliases,rationale,discovered_via) VALUES($1,$2,$3,$4,$5,$6,'manual') RETURNING id",
              [
                c.tenantId,
                projectId,
                comp.name,
                comp.domain,
                JSON.stringify(comp.aliases),
                comp.rationale ?? null,
              ],
            );
            kept.push(r.rows[0].id);
          }
        }
        await client.query(
          "DELETE FROM competitors WHERE project_id=$1 AND NOT(id=ANY($2::uuid[]))",
          [projectId, kept],
        );
        const old = (
          await client.query("SELECT id,body,active FROM monitoring_prompts WHERE project_id=$1", [
            projectId,
          ])
        ).rows;
        for (const prompt of value.prompts) {
          if (prompt.id) {
            const previous = old.find((p) => p.id === prompt.id);
            if (!previous) throw new ApiError(404, "Prompt not found", "NOT_FOUND");
            if (previous.body !== prompt.body || previous.active !== prompt.active)
              await command(client, projectId, "prompt.update", {
                id: prompt.id,
                body: prompt.body,
                active: prompt.active,
              });
          } else {
            const created = await command(client, projectId, "prompt.create", {
              body: prompt.body,
              persona: "",
            });
            if (!prompt.active)
              await command(client, projectId, "prompt.update", {
                id: created.id,
                active: false,
              });
          }
        }
        for (const prompt of old.filter(
          (p) => p.active && !value.prompts.some((v) => v.id === p.id),
        ))
          await command(client, projectId, "prompt.update", { id: prompt.id, active: false });
      });
      return this.detail(userId, projectId);
    },
    async status(userId: string, projectId: string, statusInput: unknown) {
      const status = z.enum(["active", "paused", "archived"]).parse(statusInput);
      const c = await context(userId, projectId);
      await withTenantClient(pool, c, async (client) => {
        await client.query("UPDATE projects SET status=$2 WHERE id=$1", [projectId, status]);
        if (status !== "active")
          await client.query(
            "UPDATE monitoring_schedules SET status='paused' WHERE project_id=$1 AND status IN ('active','quota_paused')",
            [projectId],
          );
      });
      return { status };
    },
    async launch(userId: string, projectId: string, keyInput: unknown, input: unknown) {
      const key = projectRequestKey.parse(keyInput),
        value = launchProjectInput.parse(input);
      const c = await context(userId, projectId);
      const engineConfigs = value.engines.map((engine) => {
        const config = options.engines.find((e) => e.engine === engine);
        if (!config?.configured)
          throw new ApiError(
            503,
            `${engine} is not configured or monitoring is disabled`,
            "ENGINE_NOT_CONFIGURED",
          );
        return config;
      });
      if (value.crawl && !options.firecrawlConfigured)
        throw new ApiError(503, "Firecrawl is not configured", "CRAWLER_NOT_CONFIGURED");
      const result = await withTenantClient(pool, c, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,73))", [projectId]);
        const previous = (
          await client.query(
            "SELECT fingerprint,result FROM project_launch_requests WHERE project_id=$1 AND request_key=$2",
            [projectId, key],
          )
        ).rows[0];
        if (previous) {
          if (previous.fingerprint !== fingerprint(value))
            throw new ApiError(
              409,
              "Launch request changed. Start a new launch.",
              "IDEMPOTENCY_CONFLICT",
            );
          return previous.result as {
            runIds: string[];
            scheduleIds: string[];
            auditId?: string;
            auditError?: string;
          };
        }
        const project = (
          await client.query("SELECT status,default_markets FROM projects WHERE id=$1", [projectId])
        ).rows[0];
        if (project.status !== "active")
          throw new ApiError(
            409,
            "Restore or resume this project before launching",
            "PROJECT_NOT_ACTIVE",
          );
        const ids = (
          await client.query("SELECT id FROM monitoring_prompts WHERE project_id=$1 AND active", [
            projectId,
          ])
        ).rows.map((p) => p.id);
        if (engineConfigs.length && !ids.length)
          throw new ApiError(400, "Add at least one active prompt", "PROMPTS_REQUIRED");
        const markets = project.default_markets as Array<{ country: string; language: string }>;
        if (ids.length * markets.length * value.samples * engineConfigs.length > 500)
          throw new ApiError(
            400,
            "Limit one launch to 500 prompt/engine/market/sample combinations",
            "BATCH_TOO_LARGE",
          );
        const result: {
          runIds: string[];
          scheduleIds: string[];
          auditId?: string;
          auditError?: string;
        } = { runIds: [], scheduleIds: [] };
        if (value.mode === "schedule" && engineConfigs.length)
          await client.query(
            "UPDATE monitoring_schedules SET status='deleted' WHERE project_id=$1 AND status<>'deleted'",
            [projectId],
          );
        for (const engine of engineConfigs)
          for (const [index, market] of markets.entries()) {
            const config = {
              engine: engine.engine,
              model: engine.model,
              promptIds: ids,
              geos: [market.country],
              languages: [market.language],
              samples: value.samples,
            };
            if (value.mode === "once") {
              const r = await command(client, projectId, "run", {
                key: `${key}-${engine.engine}-${index}`,
                config,
              });
              result.runIds.push(...((r.runIds as string[]) ?? []));
            } else {
              const r = await command(client, projectId, "schedule.create", {
                ...config,
                cadence: value.cadence,
                intervalMinutes: value.cadence === "weekly" ? 10080 : 1440,
              });
              if (r.id) result.scheduleIds.push(String(r.id));
            }
          }
        await client.query(
          "INSERT INTO project_launch_requests(project_id,tenant_id,request_key,fingerprint,result) VALUES($1,$2,$3,$4,$5)",
          [projectId, c.tenantId, key, fingerprint(value), JSON.stringify(result)],
        );
        return result;
      });
      if (value.crawl && !result.auditId) {
        try {
          const audit = await technical.forOwner(c).triggerAudit(
            c.tenantId,
            projectId,
            {
              crawlType: value.pagesLimit === 1 ? "single_page" : "key_pages",
              pagesLimit: value.pagesLimit,
            },
            key,
          );
          result.auditId = audit.auditId;
          delete result.auditError;
        } catch (error) {
          result.auditError =
            error instanceof ApiError
              ? error.message
              : "The crawl could not start. Retry from this page.";
        }
        await withTenantClient(pool, c, async (client) => {
          await client.query(
            "UPDATE project_launch_requests SET result=$3 WHERE project_id=$1 AND request_key=$2",
            [projectId, key, JSON.stringify(result)],
          );
        });
      }
      return result;
    },
  };
}
export type ProjectManagementService = ReturnType<typeof createProjectManagementService>;
