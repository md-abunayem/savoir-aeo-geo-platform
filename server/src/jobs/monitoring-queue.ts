import { z } from "zod";
import type { Pool } from "pg";
import { Queue } from "bullmq";
import { queueConnection } from "./connection.js";
import { monitoringEngine } from "../validations/monitoring.validation.js";
import type { MonitoringEngineType } from "../services/monitoring/types.js";
import type { CredentialCheck } from "../services/monitoring/credential-preflight.js";

export const MONITORING_REQUEST_QUEUE = "monitoring-requests";
export function createMonitoringControlQueue(redisUrl: string) {
  return new Queue("monitoring", {
    connection: {
      ...queueConnection(redisUrl),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    },
  });
}
export const requestJobSchema = z.object({ runId: z.uuid(), engine: monitoringEngine }).strict();

/** PostgreSQL is the durable outbox; Redis holds IDs, never prompts or keys. */
export async function dispatchMonitoringRequests(
  pool: Pool,
  queue: Queue,
  dailyLimit: number,
  now = Date.now(),
  check?: (engine: MonitoringEngineType) => Promise<CredentialCheck>,
) {
  const result = await pool.query<{
    id: string;
    engine: MonitoringEngineType;
    attempts: number;
    due_at: Date;
  }>("SELECT * FROM savoir_monitoring_dispatch($1,$2)", [dailyLimit, 100]);
  let added = 0;
  for (const run of result.rows) {
    const data = requestJobSchema.parse({ runId: run.id, engine: run.engine });
    if (check && !(await applyPreflight(pool, data, await check(data.engine)))) continue;
    const jobId = `run-${run.id}-${run.attempts}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== "failed" && state !== "completed") continue;
      await existing.remove();
    }
    await queue.add("monitoring-request", data, {
      jobId,
      delay: Math.max(0, new Date(run.due_at).getTime() - now),
      // PostgreSQL owns bounded provider retries. BullMQ must not multiply them.
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    });
    added++;
  }
  return added;
}

async function applyPreflight(
  pool: Pool,
  request: z.infer<typeof requestJobSchema>,
  check: CredentialCheck,
) {
  if (check.ok) return true;
  await pool.query("SELECT savoir_monitoring_preflight_result($1,$2,$3,$4)", [
    request.runId,
    request.engine,
    check.transient ? "PROVIDER_PREFLIGHT_UNAVAILABLE" : check.code,
    check.transient ? 60 : 0,
  ]);
  return false;
}

export async function executeMonitoringRequest(
  data: unknown,
  dependencies: {
    pool: Pool;
    check: (engine: MonitoringEngineType) => Promise<CredentialCheck>;
    processRun: (runId: string, engine: MonitoringEngineType) => Promise<boolean>;
  },
) {
  const request = requestJobSchema.parse(data);
  const check = await dependencies.check(request.engine);
  if (!(await applyPreflight(dependencies.pool, request, check))) return false;
  return dependencies.processRun(request.runId, request.engine);
}
