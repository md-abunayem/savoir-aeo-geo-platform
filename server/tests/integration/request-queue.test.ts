import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { queueConnection } from "../../src/jobs/connection.js";
import {
  dispatchMonitoringRequests,
  executeMonitoringRequest,
} from "../../src/jobs/monitoring-queue.js";
import { createMonitoringService } from "../../src/services/monitoring/monitoring.service.js";
import { createMonitoringProcessor } from "../../src/services/monitoring/processor.js";
import type { EvidenceStore, MonitoringProvider } from "../../src/services/monitoring/types.js";
import { MonitoringProviderError } from "../../src/services/monitoring/types.js";

let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let queue: Queue;
let service: ReturnType<typeof createMonitoringService>;
const userId = randomUUID(),
  tenantId = randomUUID(),
  projectId = randomUUID();
const context = { userId, tenantId };
const queueName = `monitoring-test-${randomUUID()}`;
const evidence = new Map<string, string>();
const storage: EvidenceStore = {
  put: async (key, value) => {
    evidence.set(key, value);
  },
  get: async (key) => evidence.get(key) ?? "",
};
const success = {
  status: "succeeded" as const,
  text: "Queue Brand is a test brand.",
  modelVersion: "fixture-v1",
  latencyMs: 1,
  usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
  citations: [],
  searchQueries: [],
  searchEntryPoint: null,
  grounded: false,
  raw: { text: "Queue Brand is a test brand." },
  estimatedCostUsd: 0,
  refusalReason: null,
};
const ok = async () => ({ ok: true, code: null, transient: false });

beforeAll(async () => {
  f = await createDatabaseFixture();
  await f.database.query(
    "INSERT INTO users(id,email,name,email_verified_at) VALUES($1,'queue@test.invalid','Queue Owner',now())",
    [userId],
  );
  await f.database.query("INSERT INTO tenants(id,name) VALUES($1,'Queue Tenant')", [tenantId]);
  await f.database.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [
    tenantId,
    userId,
  ]);
  await f.database.query(
    "INSERT INTO projects(id,tenant_id,brand_name,domain,status) VALUES($1,$2,'Queue Brand','queue.test','active')",
    [projectId, tenantId],
  );
  await f.database.query("INSERT INTO monitoring_credits(tenant_id,available) VALUES($1,100)", [
    tenantId,
  ]);
  service = createMonitoringService(f.runtime, storage, { enabled: true, model: "fixture" });
  queue = new Queue(queueName, {
    connection: { ...queueConnection(process.env.REDIS_URL!), maxRetriesPerRequest: 1 },
  });
  queue.on("error", () => {});
});
beforeEach(async () => {
  await queue.drain(true);
  await queue.clean(0, 100, "failed");
  await f.database.query(
    "TRUNCATE monitoring_runs,monitoring_prompts,monitoring_events,email_outbox CASCADE",
  );
  await f.database.query("UPDATE monitoring_credits SET available=100,reserved=0,used=0");
  await f.database.query(
    "UPDATE monitoring_provider_state SET calls_today=0,next_call_at=now()-interval '1 second',blocked_until=NULL",
  );
  evidence.clear();
});
afterAll(async () => {
  if (queue) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  await f?.close();
});
async function enqueue(samples = 1) {
  const prompt = await service.createPrompt(context, projectId, { body: "What is Queue Brand?" });
  const result = await service.run(context, projectId, randomUUID(), {
    promptIds: [prompt.id],
    samples,
  });
  return result.runIds as string[];
}

it("deduplicates real Redis jobs, spaces calls, and recovers the durable outbox after Redis jobs disappear", async () => {
  const ids = await enqueue(2);
  expect(await dispatchMonitoringRequests(f.runtime, queue, 100)).toBe(2);
  expect(await dispatchMonitoringRequests(f.runtime, queue, 100)).toBe(0);
  const jobs = await queue.getJobs(["waiting", "delayed"]);
  expect(jobs).toHaveLength(2);
  for (const job of jobs) {
    expect(Object.keys(job.data).sort()).toEqual(["engine", "runId"]);
    expect(job.opts.attempts).toBe(1);
  }
  await queue.drain(true);
  expect(await dispatchMonitoringRequests(f.runtime, queue, 100)).toBe(2);
  const started: number[] = [];
  let active = 0,
    maximum = 0;
  const provider: MonitoringProvider = {
    execute: vi.fn(async () => {
      started.push(Date.now());
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active--;
      return success;
    }),
  };
  const processor = createMonitoringProcessor(f.runtime, provider, storage, {
    dailyLimit: 100,
    spacingSeconds: 1,
  });
  await queue.setGlobalConcurrency(1);
  const worker = new Worker(
    queueName,
    (job) =>
      executeMonitoringRequest(job.data, {
        pool: f.runtime,
        check: ok,
        processRun: processor.processRun,
      }),
    {
      connection: queueConnection(process.env.REDIS_URL!),
      concurrency: 1,
      maxStalledCount: 0,
      limiter: { max: 1, duration: 1000 },
    },
  );
  worker.on("error", () => {});
  try {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      await dispatchMonitoringRequests(f.runtime, queue, 100);
      const rows = await f.database.query(
        "SELECT status FROM monitoring_runs WHERE id=any($1::uuid[])",
        [ids],
      );
      if (rows.rows.every((row) => row.status === "succeeded")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(
      (
        await f.database.query("SELECT status FROM monitoring_runs WHERE id=any($1::uuid[])", [ids])
      ).rows.map((row) => row.status),
    ).toEqual(["succeeded", "succeeded"]);
    expect(provider.execute).toHaveBeenCalledTimes(2);
    expect(maximum).toBe(1);
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(900);
  } finally {
    await worker.close();
  }
});

it("rejects bad credentials before dispatching the batch and releases credits without a generation call", async () => {
  await enqueue(3);
  const rejected = async () => ({ ok: false, code: "PROVIDER_HTTP_401", transient: false });
  expect(await dispatchMonitoringRequests(f.runtime, queue, 100, Date.now(), rejected)).toBe(0);
  const rows = await service.list(context, projectId, "runs");
  expect(rows).toHaveLength(3);
  expect(
    rows.every(
      (row) =>
        row.status === "failed" && row.attempts === 0 && row.error_code === "PROVIDER_HTTP_401",
    ),
  ).toBe(true);
  expect(
    (
      await f.database.query(
        "SELECT available,reserved,used FROM monitoring_credits WHERE tenant_id=$1",
        [tenantId],
      )
    ).rows[0],
  ).toEqual({ available: 100, reserved: 0, used: 0 });
});

it("defers temporary credential-check outages without consuming an API attempt", async () => {
  const [id] = await enqueue();
  const processRun = vi.fn(async () => true);
  await executeMonitoringRequest(
    { runId: id, engine: "gemini" },
    {
      pool: f.runtime,
      check: async () => ({ ok: false, code: "PROVIDER_METADATA_CHECK_FAILED", transient: true }),
      processRun,
    },
  );
  expect(processRun).not.toHaveBeenCalled();
  const run = await service.detail(context, projectId, id);
  expect(run).toMatchObject({
    status: "queued",
    attempts: 0,
    error_code: "PROVIDER_PREFLIGHT_UNAVAILABLE",
  });
  expect(new Date(run.available_at as string).getTime() - Date.now()).toBeGreaterThan(50000);
});

it("does not execute stale, duplicate, or mismatched-engine jobs", async () => {
  const [id] = await enqueue();
  const provider: MonitoringProvider = { execute: vi.fn(async () => success) };
  const processor = createMonitoringProcessor(f.runtime, provider, storage, {
    dailyLimit: 100,
    spacingSeconds: 1,
  });
  expect(await processor.processRun(id, "openai")).toBe(false);
  await Promise.all([processor.processRun(id, "gemini"), processor.processRun(id, "gemini")]);
  expect(await processor.processRun(id, "gemini")).toBe(false);
  expect(provider.execute).toHaveBeenCalledTimes(1);
});

it("accepts an idempotent user request even if its immediate Redis wake-up fails", async () => {
  const unavailable = createMonitoringService(f.runtime, storage, {
    enabled: true,
    model: "fixture",
    wakeQueue: async () => {
      throw new Error("Redis unavailable");
    },
  });
  const prompt = await service.createPrompt(context, projectId, { body: "Queue Brand research" });
  const key = randomUUID(),
    input = { promptIds: [prompt.id], samples: 1 };
  const first = await unavailable.run(context, projectId, key, input);
  const retry = await unavailable.run(context, projectId, key, input);
  expect(retry.runIds).toEqual(first.runIds);
  expect(await dispatchMonitoringRequests(f.runtime, queue, 100)).toBe(1);
});

it("delays a provider retry in Redis and PostgreSQL without another immediate API call", async () => {
  const [id] = await enqueue();
  const provider: MonitoringProvider = {
    execute: vi.fn(async () => {
      throw new MonitoringProviderError("PROVIDER_RATE_LIMITED_RETRYABLE", true, 60);
    }),
  };
  const processor = createMonitoringProcessor(f.runtime, provider, storage, {
    dailyLimit: 100,
    spacingSeconds: 1,
  });
  expect(await processor.processRun(id, "gemini")).toBe(true);
  const run = (
    await f.database.query("SELECT status,attempts,available_at FROM monitoring_runs WHERE id=$1", [
      id,
    ])
  ).rows[0];
  expect(run).toMatchObject({ status: "queued", attempts: 1 });
  expect(new Date(run.available_at).getTime()).toBeGreaterThan(Date.now() + 55000);
  expect(await dispatchMonitoringRequests(f.runtime, queue, 100)).toBe(1);
  const jobs = await queue.getJobs(["delayed"]);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].id).toBe(`run-${id}-1`);
  expect(jobs[0].delay).toBeGreaterThan(55000);
  expect(await processor.processRun(id, "gemini")).toBe(false);
  expect(provider.execute).toHaveBeenCalledTimes(1);
});

it("recovers expired provider leases as uncertain without dispatching another request", async () => {
  const [id] = await enqueue();
  const claimed = await f.runtime.query("SELECT * FROM savoir_monitoring_claim_run($1,$2,$3,$4)", [
    id,
    "gemini",
    100,
    1,
  ]);
  expect(claimed.rowCount).toBe(1);
  await f.database.query(
    "UPDATE monitoring_runs SET locked_at=now()-interval '6 minutes' WHERE id=$1",
    [id],
  );
  expect(await dispatchMonitoringRequests(f.runtime, queue, 100)).toBe(0);
  expect(await service.detail(context, projectId, id)).toMatchObject({
    status: "uncertain",
    error_code: "WORKER_LEASE_EXPIRED",
    attempts: 1,
  });
});
