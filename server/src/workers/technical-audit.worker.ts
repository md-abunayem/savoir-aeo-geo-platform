import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { parseEnvironment } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { createDatabase } from "../db/index.js";
import { queueConnection } from "../jobs/connection.js";
import { TechnicalAuditService } from "../services/technical/technical-audit.service.js";

async function main() {
  const env = parseEnvironment(process.env);
  const logger = createLogger(env.LOG_LEVEL);
  const { pool } = createDatabase(env.DATABASE_APP_URL ?? env.DATABASE_URL ?? "");
  const role = await pool.query(
    "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user",
  );
  if (!role.rows[0] || Object.values(role.rows[0]).some(Boolean)) {
    await pool.end();
    throw new Error("Restricted runtime role required");
  }

  const technical = new TechnicalAuditService(pool, {
    firecrawlApiKey: env.FIRECRAWL_API_KEY,
    firecrawlApiUrl: env.FIRECRAWL_API_URL,
  });
  const connection = queueConnection(env.REDIS_URL);
  const queue = new Queue("technical-audit-schedules", {
    connection: { ...connection, maxRetriesPerRequest: 1 },
  });
  const worker = new Worker(
    "technical-audit-schedules",
    async (job) => {
      if (job.name !== "technical-audit-schedule-tick")
        throw new Error("Unsupported technical audit schedule job");
      const due = await pool.query<{
        schedule_id: string;
        tenant_id: string;
        project_id: string;
        user_id: string;
      }>("SELECT * FROM public.savoir_technical_audit_claim_due($1)", [10]);
      for (const schedule of due.rows) {
        try {
          await technical
            .forOwner({
              tenantId: schedule.tenant_id,
              userId: schedule.user_id,
            })
            .triggerAudit(schedule.tenant_id, schedule.project_id, {
              crawlType: "full_site",
              pagesLimit: 500,
            });
        } catch (error) {
          logger.error(
            {
              scheduleId: schedule.schedule_id,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            "scheduled technical audit failed to start",
          );
        }
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on("error", () => logger.error("technical audit scheduler worker error"));
  worker.on("failed", (job) =>
    logger.error({ jobId: job?.id }, "technical audit scheduler job failed"),
  );

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    void Promise.all([worker.close(), queue.close()])
      .then(() => pool.end())
      .then(() => clearTimeout(deadline))
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await queue.upsertJobScheduler(
      "technical-audit-poll",
      { every: 60_000 },
      {
        name: "technical-audit-schedule-tick",
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { count: 20 },
          removeOnFail: { count: 100 },
        },
      },
    );
    logger.info("Technical audit scheduler started");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "technical audit scheduler startup failed",
    );
    stop();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Technical audit scheduler cannot start:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
