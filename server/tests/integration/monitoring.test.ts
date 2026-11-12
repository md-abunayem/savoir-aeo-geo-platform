import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMonitoringNotifier } from "../../src/services/monitoring/notifications.js";
import { createPayloadCipher } from "../../src/services/email/crypto.js";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import request from "supertest";
import { createDatabaseFixture } from "./database-fixture.js";
import { createMonitoringService } from "../../src/services/monitoring/monitoring.service.js";
import { createMonitoringProcessor } from "../../src/services/monitoring/processor.js";
import {
  MonitoringProviderError,
  type EvidenceStore,
  type MonitoringProvider,
} from "../../src/services/monitoring/types.js";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/config/logger.js";
let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let service: ReturnType<typeof createMonitoringService>;
const owner = randomUUID(),
  other = randomUUID(),
  tenant = randomUUID(),
  tenantB = randomUUID(),
  project = randomUUID(),
  projectB = randomUUID();
const context = { tenantId: tenant, userId: owner };
const evidence = new Map<string, string>();
const storage: EvidenceStore = {
  put: async (k, v) => {
    if (evidence.has(k)) throw new Error("immutable");
    evidence.set(k, v);
  },
  get: async (k) => evidence.get(k) ?? "",
};
const answer = {
  status: "succeeded" as const,
  text: "Tea answer",
  modelVersion: "fixture-model-v1",
  latencyMs: 20,
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  citations: [{ url: "https://example.com", title: "Source" }],
  searchQueries: ["tea"],
  searchEntryPoint: null,
  grounded: true,
  raw: { text: "Tea contact owner@example.com" },
  estimatedCostUsd: null,
  refusalReason: null,
};
const provider: MonitoringProvider = { execute: vi.fn(async () => answer) };
const processor = () =>
  createMonitoringProcessor(f.runtime, provider, storage, { dailyLimit: 100, spacingSeconds: 1 });
const prompt = async () =>
  (await service.createPrompt(context, project, { body: "Best tea brands?" })) as { id: string };
const queue = async (samples = 1) => {
  const p = await prompt();
  const result = await service.run(context, project, randomUUID(), { promptIds: [p.id], samples });
  return { prompt: p, id: (result.runIds as string[])[0]! };
};
async function unblock() {
  await f.database.query(
    "UPDATE monitoring_provider_state SET next_call_at=now()-interval '1 second',blocked_until=NULL",
  );
  await f.database.query(
    "UPDATE monitoring_runs SET available_at=now()-interval '1 second' WHERE status='queued'",
  );
}
beforeAll(async () => {
  f = await createDatabaseFixture();
  await f.database.query(
    "INSERT INTO users(id,name,email,email_verified_at) VALUES($1,'A','monitor-a@test.invalid',now()),($2,'B','monitor-b@test.invalid',now())",
    [owner, other],
  );
  await f.database.query("INSERT INTO tenants(id,name) VALUES($1,'A'),($2,'B')", [tenant, tenantB]);
  await f.database.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')",
    [tenant, owner, tenantB, other],
  );
  await f.database.query(
    "INSERT INTO projects(id,tenant_id,brand_name,domain,status) VALUES($1,$2,'A','a.test','active'),($3,$4,'B','b.test','active')",
    [project, tenant, projectB, tenantB],
  );
  await f.database.query(
    "INSERT INTO monitoring_credits(tenant_id,available) VALUES($1,100),($2,100)",
    [tenant, tenantB],
  );
  service = createMonitoringService(f.runtime, storage, { model: "fixture-model", enabled: true });
});
beforeEach(async () => {
  await f.database.query(
    "TRUNCATE monitoring_runs,monitoring_schedules,monitoring_prompts,monitoring_events,email_outbox,monitoring_prompt_requests,monitoring_schedule_requests CASCADE",
  );
  await f.database.query(
    "UPDATE monitoring_credits SET available=100,reserved=0,used=0,minimum_interval_minutes=1440",
  );
  await f.database.query(
    "UPDATE monitoring_provider_state SET next_call_at=now()-interval '1 second',blocked_until=NULL,failure_since=NULL,calls_today=0,last_model=NULL",
  );
  evidence.clear();
  vi.mocked(provider.execute).mockReset().mockResolvedValue(answer);
});
afterAll(async () => {
  await f?.close();
});
it("enforces tenant/project isolation and denies direct credit mutation", async () => {
  await expect(service.createPrompt(context, projectB, { body: "test" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    service.health({ userId: owner, tenantId: tenantB }, projectB),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(f.runtime.query("UPDATE monitoring_credits SET available=100000")).rejects.toThrow();
  expect((await f.runtime.query("SELECT * FROM monitoring_credits")).rowCount).toBe(0);
  await expect(
    f.runtime.query("SELECT savoir_monitoring_enqueue($1,$2,$3,$4)", [
      tenant,
      project,
      {},
      "forged-key",
    ]),
  ).rejects.toThrow();
});

it("creates one prompt for concurrent retries and rejects changed inputs for the same key", async () => {
  const key = randomUUID();
  const input = { body: "Which tea is best?", persona: "Buyer" };
  const results = await Promise.all(
    Array.from({ length: 4 }, () => service.createPrompt(context, project, input, key)),
  );
  expect(new Set(results.map((p) => p.id)).size).toBe(1);
  expect(await service.createPrompt(context, project, input, key)).toEqual(results[0]);
  expect(await service.list(context, project, "prompts")).toHaveLength(1);
  await expect(
    service.createPrompt(context, project, { body: "Different question" }, key),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    service.createPrompt({ userId: other, tenantId: tenantB }, project, input, key),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("imports prompts idempotently, tracks versions, and recovers archived prompts", async () => {
  const key = randomUUID();
  const input = {
    prompts: [
      { body: "Which tea brands are best?", persona: "First-time buyer", tags: ["comparison"] },
      { body: "Which tea brands are best?", tags: ["comparison"] },
      { body: "How do tea subscriptions compare?", tags: ["subscriptions"] },
    ],
  };
  const imported = (await service.importPrompts(context, project, input, key)) as {
    created: number;
    skipped: number;
    prompts: { id: string }[];
  };
  expect(imported.created).toBe(2);
  expect(imported.skipped).toBe(1);
  expect(await service.importPrompts(context, project, input, key)).toEqual(imported);

  const firstId = imported.prompts[0]!.id;
  expect(await service.promptVersions(context, project, firstId)).toHaveLength(1);
  await service.updatePrompt(context, project, firstId, {
    body: "Best tea brands for a new buyer?",
  });
  expect(await service.promptVersions(context, project, firstId)).toHaveLength(2);

  await service.bulkPrompts(context, project, { promptIds: [firstId], action: "archive" });
  expect((await service.list(context, project, "prompts")).some((row) => row.id === firstId)).toBe(
    false,
  );
  expect(
    (await service.list(context, project, "prompts", { includeArchived: "true" })).some(
      (row) => row.id === firstId,
    ),
  ).toBe(true);
  await service.bulkPrompts(context, project, { promptIds: [firstId], action: "restore" });
  const restored = (await service.list(context, project, "prompts")).find(
    (row) => row.id === firstId,
  );
  expect(restored).toMatchObject({ active: true, archived_at: null });

  await service.bulkPrompts(context, project, {
    promptIds: [firstId],
    action: "add-tag",
    tag: "reviewed",
  });
  expect(
    (await service.list(context, project, "prompts")).find((row) => row.id === firstId)?.tags,
  ).toContain("reviewed");
  expect(await service.promptAnswers(context, project, firstId)).toEqual([]);
  expect(await service.promptSuggestions(context, project)).toMatchObject({
    source: "local",
    billable: false,
  });
});

it("creates one schedule across concurrent retries, rejects conflicting inputs, and never resumes it on replay", async () => {
  const p = await prompt(),
    key = randomUUID();
  const input = { promptIds: [p.id], cadence: "daily" };
  const results = await Promise.all(
    Array.from({ length: 4 }, () => service.createSchedule(context, project, input, key)),
  );
  expect(new Set(results.map((s) => s.id)).size).toBe(1);
  expect(await service.list(context, project, "schedules")).toHaveLength(1);
  await expect(
    service.createSchedule(context, project, { ...input, cadence: "weekly" }, key),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    service.createSchedule({ tenantId: tenantB, userId: other }, project, input, key),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await service.scheduleStatus(context, project, String(results[0].id), { status: "paused" });
  const disabled = createMonitoringService(f.runtime, storage, {
    model: "fixture-model",
    enabled: false,
  });
  expect((await disabled.createSchedule(context, project, input, key)).id).toBe(results[0].id);
  expect((await service.list(context, project, "schedules"))[0].status).toBe("paused");
  await expect(
    disabled.createSchedule(context, project, input, randomUUID()),
  ).rejects.toMatchObject({ code: "ENGINE_NOT_CONFIGURED" });
});

it("rolls back a schedule when saving its retry receipt fails", async () => {
  const p = await prompt();
  await f.database.query(
    "ALTER TABLE monitoring_schedule_requests ADD CONSTRAINT test_schedule_receipt CHECK(request_key <> 'rollback-key')",
  );
  try {
    await expect(
      service.createSchedule(context, project, { promptIds: [p.id] }, "rollback-key"),
    ).rejects.toThrow();
    expect(await service.list(context, project, "schedules")).toHaveLength(0);
  } finally {
    await f.database.query(
      "ALTER TABLE monitoring_schedule_requests DROP CONSTRAINT test_schedule_receipt",
    );
  }
  await service.createSchedule(context, project, { promptIds: [p.id] }, "rollback-key");
  expect(await service.list(context, project, "schedules")).toHaveLength(1);
});

it("rolls back prompt creation when its idempotency receipt cannot be saved", async () => {
  await f.database.query(
    "ALTER TABLE monitoring_prompt_requests ADD CONSTRAINT test_receipt_rejection CHECK(request_key <> 'rollback-key')",
  );
  try {
    await expect(
      service.createPrompt(context, project, { body: "Atomic creation" }, "rollback-key"),
    ).rejects.toThrow();
    expect(await service.list(context, project, "prompts")).toHaveLength(0);
  } finally {
    await f.database.query(
      "ALTER TABLE monitoring_prompt_requests DROP CONSTRAINT test_receipt_rejection",
    );
  }
  await service.createPrompt(context, project, { body: "Atomic creation" }, "rollback-key");
  expect(await service.list(context, project, "prompts")).toHaveLength(1);
});

it("paginates prompts with tied timestamps without losing or duplicating rows", async () => {
  await f.database.query(
    "INSERT INTO monitoring_prompts(tenant_id,project_id,body,created_at) SELECT $1,$2,'Question ' || n,now() FROM generate_series(1,105) n",
    [tenant, project],
  );
  const first = await service.list(context, project, "prompts", { limit: 100 });
  const second = await service.list(context, project, "prompts", {
    limit: 100,
    before: first[99].id,
  });
  expect(first).toHaveLength(100);
  expect(second).toHaveLength(5);
  expect(new Set([...first, ...second].map((p) => p.id)).size).toBe(105);
});
it("reports observed engine health only from the selected project", async () => {
  const initial = await service.engines(context, project);
  expect(initial.find((item) => item.engine === "gemini")).toMatchObject({
    configured: true,
    observationStatus: null,
    observedAt: null,
  });
  expect(initial.find((item) => item.engine === "openai")).toMatchObject({
    configured: false,
    observationStatus: null,
  });

  await f.database.query(
    `INSERT INTO monitoring_runs
      (tenant_id,project_id,batch_key,item_key,request,status,result,completed_at)
     VALUES($1,$2,'health-a','health-a', $3, 'succeeded', $4, now())`,
    [
      tenant,
      project,
      JSON.stringify({ engine: "gemini", model: "fixture-model" }),
      JSON.stringify({ modelVersion: "fixture-model-v1", grounded: true }),
    ],
  );
  await f.database.query(
    `INSERT INTO monitoring_runs
      (tenant_id,project_id,batch_key,item_key,request,status,error_code,completed_at)
     VALUES($1,$2,'health-b','health-b', $3, 'failed', 'PROVIDER_HTTP_403', now())`,
    [tenantB, projectB, JSON.stringify({ engine: "gemini", model: "other-model" })],
  );

  const selectedProject = await service.engines(context, project);
  expect(selectedProject.find((item) => item.engine === "gemini")).toMatchObject({
    configured: true,
    observationStatus: "succeeded",
    observedModel: "fixture-model-v1",
    errorCode: null,
  });
  await expect(service.engines(context, projectB)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const otherAccount = await service.engines({ userId: other, tenantId: tenantB }, projectB);
  expect(otherAccount.find((item) => item.engine === "gemini")).toMatchObject({
    observationStatus: "failed",
    errorCode: "PROVIDER_HTTP_403",
    observedModel: "other-model",
  });
});
it("reserves credits once for concurrent duplicate requests and rejects changed reuse", async () => {
  const p = await prompt(),
    key = randomUUID(),
    input = { promptIds: [p.id], samples: 2 };
  const results = await Promise.all([
    service.run(context, project, key, input),
    service.run(context, project, key, input),
  ]);
  expect(results[0].runIds).toEqual(results[1].runIds);
  expect(
    (await f.database.query("SELECT reserved FROM monitoring_credits WHERE tenant_id=$1", [tenant]))
      .rows[0].reserved,
  ).toBe(2);
  await expect(service.run(context, project, key, { ...input, samples: 1 })).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
});
it("cannot overspend credits across simultaneous submissions and retains quota notifications", async () => {
  await f.database.query("UPDATE monitoring_credits SET available=1 WHERE tenant_id=$1", [tenant]);
  const p = await prompt();
  const results = await Promise.allSettled([
    service.run(context, project, randomUUID(), { promptIds: [p.id], samples: 1 }),
    service.run(context, project, randomUUID(), { promptIds: [p.id], samples: 1 }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (
      await f.database.query(
        "SELECT available,reserved FROM monitoring_credits WHERE tenant_id=$1",
        [tenant],
      )
    ).rows[0],
  ).toEqual({ available: 0, reserved: 1 });
  expect(
    (await service.list(context, project, "events")).some((e) => e.kind === "quota.exhausted"),
  ).toBe(true);
});
it("stores immutable evidence, normalized metadata and settles a successful run only once", async () => {
  const { id, prompt: p } = await queue();
  await service.updatePrompt(context, project, p.id, { body: "A changed prompt" });
  expect(await processor().processNext()).toBe(true);
  expect(await processor().processNext()).toBe(false);
  expect(provider.execute).toHaveBeenCalledTimes(1);
  const run = await service.detail(context, project, id);
  expect(run.status).toBe("succeeded");
  expect((run.request as { prompt: string }).prompt).toBe("Best tea brands?");
  const promptMetrics = (await service.list(context, project, "prompts")).find(
    (item) => item.id === p.id,
  );
  expect(promptMetrics).toMatchObject({
    visibility: 0,
    cited_count: 1,
    answer_count: 1,
    engines: ["gemini"],
  });
  expect(await service.promptSummary(context, project)).toMatchObject({ avg_visibility: 0 });
  const result = run.result as { evidenceKey: string; evidenceHash: string };
  expect(result.evidenceHash).toBe(
    createHash("sha256").update(evidence.get(result.evidenceKey)!).digest("hex"),
  );
  expect(JSON.stringify(await service.evidence(context, project, id))).not.toContain(
    "owner@example.com",
  );
  expect(
    (
      await f.database.query(
        "SELECT available,reserved,used FROM monitoring_credits WHERE tenant_id=$1",
        [tenant],
      )
    ).rows[0],
  ).toEqual({ available: 99, reserved: 0, used: 1 });
  const late = await f.runtime.query(
    "SELECT savoir_monitoring_finish($1,$2,'succeeded',$3,NULL,0) AS accepted",
    [id, randomUUID(), run.result],
  );
  expect(late.rows[0].accepted).toBe(false);
});
it("retries three times after the initial attempt, honors Retry-After, then releases the credit", async () => {
  const { id } = await queue();
  vi.mocked(provider.execute).mockRejectedValue(
    new MonitoringProviderError("PROVIDER_RATE_LIMITED_RETRYABLE", true, 120),
  );
  for (let i = 0; i < 4; i++) {
    await unblock();
    expect(await processor().processNext()).toBe(true);
    if (i < 3) {
      const r = await service.detail(context, project, id);
      expect(new Date(r.available_at as string).getTime() - Date.now()).toBeGreaterThan(110000);
    }
  }
  expect(provider.execute).toHaveBeenCalledTimes(4);
  expect((await service.detail(context, project, id)).status).toBe("failed");
  expect(
    (
      await f.database.query(
        "SELECT available,reserved,used FROM monitoring_credits WHERE tenant_id=$1",
        [tenant],
      )
    ).rows[0],
  ).toEqual({ available: 100, reserved: 0, used: 0 });
});
it("retries an unidentified quota rejection with bounded backoff then refunds its reserved credit", async () => {
  const { id } = await queue();
  vi.mocked(provider.execute).mockRejectedValue(
    new MonitoringProviderError("PROVIDER_RATE_LIMITED_RETRYABLE", true),
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    await unblock();
    expect(await processor().processNext()).toBe(true);
    const run = await service.detail(context, project, id);
    if (attempt < 3) {
      expect(run).toMatchObject({
        status: "queued",
        error_code: "PROVIDER_RATE_LIMITED_RETRYABLE",
        attempts: attempt + 1,
      });
      expect(new Date(run.available_at as string).getTime() - Date.now()).toBeGreaterThan(8000);
    } else {
      expect(run).toMatchObject({
        status: "failed",
        error_code: "PROVIDER_RATE_LIMITED_RETRYABLE",
        attempts: 4,
      });
    }
  }
  expect(provider.execute).toHaveBeenCalledTimes(4);
  expect(await processor().processNext()).toBe(false);
  expect(
    (
      await f.database.query(
        "SELECT available,reserved,used FROM monitoring_credits WHERE tenant_id=$1",
        [tenant],
      )
    ).rows[0],
  ).toEqual({ available: 100, reserved: 0, used: 0 });
});

it("stops only legacy queued quota retries, settles credits once, and enforces ownership", async () => {
  await queue(2);
  vi.mocked(provider.execute).mockRejectedValue(
    new MonitoringProviderError("PROVIDER_RATE_LIMITED", true, 120),
  );
  await processor().processNext();
  expect(await service.stopQuotaRetries(context, project)).toEqual({ stopped: 1 });
  expect(await service.stopQuotaRetries(context, project)).toEqual({ stopped: 0 });
  expect(provider.execute).toHaveBeenCalledTimes(1);
  const runs = await service.list(context, project, "runs");
  expect(runs.filter((run) => run.status === "queued")).toHaveLength(1);
  expect(runs.find((run) => run.status === "failed")).toMatchObject({
    error_code: "PROVIDER_QUOTA_REVIEW_REQUIRED",
    attempts: 1,
  });
  expect(
    (
      await f.database.query(
        "SELECT available,reserved,used FROM monitoring_credits WHERE tenant_id=$1",
        [tenant],
      )
    ).rows[0],
  ).toEqual({ available: 99, reserved: 1, used: 0 });
  await expect(
    service.stopQuotaRetries({ userId: other, tenantId: tenantB }, project),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("preserves retries explicitly scheduled by the provider", async () => {
  await queue();
  vi.mocked(provider.execute).mockRejectedValue(
    new MonitoringProviderError("PROVIDER_RATE_LIMITED_RETRYABLE", true, 120),
  );
  await processor().processNext();
  expect(await service.stopQuotaRetries(context, project)).toEqual({ stopped: 0 });
  expect((await service.list(context, project, "runs"))[0].status).toBe("queued");
});

it("records refusals as completed observations and does not rerun ambiguous calls", async () => {
  const first = await queue();
  vi.mocked(provider.execute).mockResolvedValue({
    ...answer,
    status: "refused",
    refusalReason: "SAFETY",
    text: "",
  });
  await processor().processNext();
  expect((await service.detail(context, project, first.id)).status).toBe("refused");
  const second = await queue();
  await unblock();
  vi.mocked(provider.execute).mockRejectedValue(
    new MonitoringProviderError("NETWORK", false, 0, true),
  );
  await processor().processNext();
  expect((await service.detail(context, project, second.id)).status).toBe("uncertain");
  expect(
    (
      await f.database.query("SELECT used,reserved FROM monitoring_credits WHERE tenant_id=$1", [
        tenant,
      ])
    ).rows[0],
  ).toEqual({ used: 1, reserved: 0 });
});
it("recovers expired worker leases without a repeated paid call", async () => {
  const { id } = await queue();
  await f.runtime.query("SELECT * FROM savoir_monitoring_claim(100,1)");
  await f.database.query(
    "UPDATE monitoring_runs SET locked_at=now()-interval '6 minutes' WHERE id=$1",
    [id],
  );
  await unblock();
  expect(await processor().processNext()).toBe(false);
  expect(provider.execute).not.toHaveBeenCalled();
  expect((await service.detail(context, project, id)).status).toBe("uncertain");
  expect(
    (await f.database.query("SELECT reserved FROM monitoring_credits WHERE tenant_id=$1", [tenant]))
      .rows[0].reserved,
  ).toBe(0);
});
it("schedules only entitled intervals, deduplicates ticks and pauses on quota exhaustion", async () => {
  const p = await prompt();
  await expect(
    service.createSchedule(context, project, {
      promptIds: [p.id],
      cadence: "custom",
      intervalMinutes: 60,
    }),
  ).rejects.toMatchObject({ code: "SCHEDULE_NOT_ENTITLED" });
  const schedule = await service.createSchedule(context, project, { promptIds: [p.id] });
  await Promise.all([processor().tick(), processor().tick()]);
  expect((await service.list(context, project, "runs")).length).toBe(1);
  await service.scheduleStatus(context, project, String(schedule.id), { status: "paused" });
  await f.database.query("UPDATE monitoring_schedules SET next_run_at=now()-interval '1 day'");
  await processor().tick();
  expect((await service.list(context, project, "runs")).length).toBe(1);
  await f.database.query("UPDATE monitoring_credits SET available=0 WHERE tenant_id=$1", [tenant]);
  await service.scheduleStatus(context, project, String(schedule.id), { status: "active" });
  await processor().tick();
  expect((await service.list(context, project, "schedules"))[0].status).toBe("quota_paused");
});
it("skips paused prompts and inactive projects; disables unconfigured execution", async () => {
  const p = await prompt();
  await service.createSchedule(context, project, { promptIds: [p.id] });
  await service.updatePrompt(context, project, p.id, { active: false });
  await processor().tick();
  expect((await service.list(context, project, "runs")).length).toBe(0);
  await service.updatePrompt(context, project, p.id, { active: true });
  await f.database.query("UPDATE projects SET status='draft' WHERE id=$1", [project]);
  try {
    await expect(
      service.run(context, project, randomUUID(), { promptIds: [p.id] }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_ACTIVE" });
  } finally {
    await f.database.query("UPDATE projects SET status='active' WHERE id=$1", [project]);
  }
  await expect(
    createMonitoringService(f.runtime, storage, { model: "fixture", enabled: false }).run(
      context,
      project,
      randomUUID(),
      { promptIds: [p.id] },
    ),
  ).rejects.toMatchObject({ code: "MONITORING_DISABLED" });
});
it("enforces provider daily budgets and flags model changes", async () => {
  await queue(2);
  const proc = createMonitoringProcessor(f.runtime, provider, storage, {
    dailyLimit: 1,
    spacingSeconds: 1,
  });
  expect(await proc.processNext()).toBe(true);
  await unblock();
  expect(await proc.processNext()).toBe(false);
  await f.database.query("UPDATE monitoring_provider_state SET calls_today=0");
  vi.mocked(provider.execute).mockResolvedValue({ ...answer, modelVersion: "fixture-v2" });
  expect(await proc.processNext()).toBe(true);
  expect(
    (await service.list(context, project, "events")).some((e) => e.kind === "engine.model_changed"),
  ).toBe(true);
  expect((await service.health(context, project)).backlog).toBe(0);
});
it("protects HTTP routes with sessions, CSRF, ownership and documents the contract", async () => {
  const app = createApp({
    origins: [],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    monitoring: service,
    auth: {
      service: {
        authenticate: async () => ({ id: owner, name: "A", email: "monitor-a@test.invalid" }),
        login: vi.fn(),
        refresh: vi.fn(),
        logout: vi.fn(),
      },
      limiter: { consume: async () => ({ allowed: true, retryAfter: 1 }) },
      csrfSecret: "c".repeat(64),
      secureCookies: false,
    },
  });
  const root = `/v1/tenants/${tenant}/projects/${project}/monitoring`;
  expect((await request(app).get(root + "/health")).status).toBe(401);
  expect(
    (
      await request(app)
        .post(root + "/prompts")
        .set("Cookie", "savoir_access=test")
        .send({ body: "question" })
    ).status,
  ).toBe(403);
  const agent = request.agent(app);
  const csrf = await agent.get("/v1/auth/csrf");
  const promptKey = randomUUID();
  const response = await agent
    .post(root + "/prompts")
    .set("Cookie", "savoir_access=test; " + String(csrf.headers["set-cookie"]).split(";")[0]!)
    .set("X-CSRF-Token", csrf.body.data.csrfToken)
    .set("Idempotency-Key", promptKey)
    .send({ body: "question" });
  expect(response.status).toBe(201);
  const promptId = response.body.data.id;
  const retry = await agent
    .post(root + "/prompts")
    .set("Cookie", "savoir_access=test; " + String(csrf.headers["set-cookie"]).split(";")[0]!)
    .set("X-CSRF-Token", csrf.body.data.csrfToken)
    .set("Idempotency-Key", promptKey)
    .send({ body: "question" });
  expect(retry.status).toBe(201);
  expect(retry.body.data.id).toBe(promptId);
  expect(await service.list(context, project, "prompts")).toHaveLength(1);
  const scheduleKey = randomUUID();
  const scheduleResponses = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    scheduleResponses.push(
      await agent
        .post(root + "/schedules")
        .set("Cookie", "savoir_access=test; " + String(csrf.headers["set-cookie"]).split(";")[0]!)
        .set("X-CSRF-Token", csrf.body.data.csrfToken)
        .set("Idempotency-Key", scheduleKey)
        .send({ promptIds: [promptId] }),
    );
  }
  expect(scheduleResponses.map((response) => response.status)).toEqual([201, 201]);
  expect(scheduleResponses[0].body.data.id).toBe(scheduleResponses[1].body.data.id);
  const controlPath = root + "/prompts/" + promptId + "/schedules/status";
  expect((await request(app).post(controlPath).send({ status: "paused" })).status).toBe(401);
  expect(
    (
      await request(app)
        .post(controlPath)
        .set("Cookie", "savoir_access=test")
        .send({ status: "paused" })
    ).status,
  ).toBe(403);
  const controlled = await agent
    .post(controlPath)
    .set("Cookie", "savoir_access=test; " + String(csrf.headers["set-cookie"]).split(";")[0]!)
    .set("X-CSRF-Token", csrf.body.data.csrfToken)
    .send({ status: "paused" });
  expect(controlled.status).toBe(200);
  expect(controlled.body.data.schedules[0].config.pausedPromptIds).toEqual([promptId]);
  const spec = await request(app).get("/v1/openapi.json");
  expect(
    spec.body.paths[
      "/v1/tenants/{tenantId}/projects/{projectId}/monitoring/prompts/{id}/schedules/status"
    ].post,
  ).toBeDefined();
  expect(
    spec.body.paths["/v1/tenants/{tenantId}/projects/{projectId}/monitoring/runs"],
  ).toBeDefined();
});

it("queues Owner notifications once without exposing email payloads", async () => {
  await f.database.query("UPDATE monitoring_credits SET available=0 WHERE tenant_id=$1", [tenant]);
  const p = await prompt();
  await expect(
    service.run(context, project, randomUUID(), { promptIds: [p.id], samples: 1 }),
  ).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
  const key = "ab".repeat(32);
  const notifier = createMonitoringNotifier(f.runtime, key);
  expect(await notifier.drain()).toBe(1);
  expect(await notifier.drain()).toBe(0);
  const mail = await f.database.query("SELECT encrypted_payload FROM email_outbox");
  expect(mail.rowCount).toBe(1);
  expect(mail.rows[0].encrypted_payload).not.toContain("quota.exhausted");
  expect(
    JSON.stringify(createPayloadCipher(key).decrypt(mail.rows[0].encrypted_payload)),
  ).toContain("quota.exhausted");
});
it("refunds ambiguous storage failures without another provider call", async () => {
  const { id } = await queue();
  const broken: EvidenceStore = {
    get: storage.get,
    put: async () => {
      throw new Error("storage unavailable");
    },
  };
  const proc = createMonitoringProcessor(f.runtime, provider, broken, {
    dailyLimit: 100,
    spacingSeconds: 1,
  });
  await proc.processNext();
  await unblock();
  expect(await proc.processNext()).toBe(false);
  expect(provider.execute).toHaveBeenCalledTimes(1);
  expect((await service.detail(context, project, id)).error_code).toBe("EVIDENCE_WRITE_UNCERTAIN");
  expect(
    (
      await f.database.query("SELECT available FROM monitoring_credits WHERE tenant_id=$1", [
        tenant,
      ])
    ).rows[0].available,
  ).toBe(100);
});
it("rolls back credit reservation and dispatch when inserting a run fails", async () => {
  const p = await prompt();
  await f.database.query(
    "CREATE FUNCTION reject_monitoring_test_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$",
  );
  await f.database.query(
    "CREATE TRIGGER reject_monitoring_test_run BEFORE INSERT ON monitoring_runs FOR EACH ROW EXECUTE FUNCTION reject_monitoring_test_run()",
  );
  try {
    await expect(
      service.run(context, project, randomUUID(), { promptIds: [p.id], samples: 2 }),
    ).rejects.toThrow();
    expect(
      (
        await f.database.query(
          "SELECT available,reserved FROM monitoring_credits WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0],
    ).toEqual({ available: 100, reserved: 0 });
  } finally {
    await f.database.query("DROP TRIGGER reject_monitoring_test_run ON monitoring_runs");
    await f.database.query("DROP FUNCTION reject_monitoring_test_run()");
  }
});
it("supports project-wide pause and preserves persona when only toggling a prompt", async () => {
  const p = await service.createPrompt(context, project, {
    body: "A question",
    persona: "business buyer",
  });
  await service.updatePrompt(context, project, String(p.id), { active: false });
  expect((await service.list(context, project, "prompts"))[0].persona).toBe("business buyer");
  await service.updatePrompt(context, project, String(p.id), { active: true });
  await service.createSchedule(context, project, { promptIds: [p.id] });
  await service.createSchedule(context, project, { promptIds: [p.id], cadence: "weekly" });
  await service.allScheduleStatus(context, project, { status: "paused" });
  expect(
    (await service.list(context, project, "schedules")).every((s) => s.status === "paused"),
  ).toBe(true);
});

it("provisions development data only once for the same setup request", async () => {
  const command = promisify(execFile);
  const requestId = randomUUID();
  const args = [
    "--import",
    "tsx",
    "src/scripts/monitoring-provision.ts",
    "--email",
    "monitor-a@test.invalid",
    "--domain",
    "example.com",
    "--credits",
    "7",
    "--request-id",
    requestId,
  ];
  const env = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: f.database.options.connectionString,
  };
  const first = JSON.parse((await command(process.execPath, args, { env })).stdout.trim());
  const second = JSON.parse((await command(process.execPath, args, { env })).stdout.trim());
  expect(second).toEqual(first);
  expect(first.testOnly).toBe(true);
  expect(
    (
      await f.database.query("SELECT available FROM monitoring_credits WHERE tenant_id=$1", [
        first.tenantId,
      ])
    ).rows[0].available,
  ).toBe(7);
  expect(
    (
      await f.database.query(
        "SELECT count(*)::int AS n FROM monitoring_events WHERE details->>'requestId'=$1",
        [requestId],
      )
    ).rows[0].n,
  ).toBe(1);
}, 60000);

async function dueSchedules() {
  await f.database.query("UPDATE monitoring_schedules SET next_run_at=now()-interval '1 day'");
}
it("pauses and resumes one prompt in shared schedules without changing reserved runs", async () => {
  const a = await prompt(),
    b = await prompt();
  const schedule = await service.createSchedule(context, project, { promptIds: [a.id, b.id] });
  await processor().tick();
  const originalRuns = await service.list(context, project, "runs");
  expect(originalRuns).toHaveLength(2);
  await service.promptScheduleStatus(context, project, a.id, { status: "paused" });
  await service.promptScheduleStatus(context, project, a.id, { status: "paused" });
  const paused = (await service.list(context, project, "schedules"))[0]!;
  expect(paused.id).toBe(schedule.id);
  expect(paused.config).toMatchObject({ promptIds: [a.id, b.id], pausedPromptIds: [a.id] });
  expect(await service.list(context, project, "runs")).toEqual(originalRuns);
  await dueSchedules();
  await processor().tick();
  let runs = await service.list(context, project, "runs");
  expect(runs).toHaveLength(3);
  expect(runs.filter((r) => (r.request as { promptId: string }).promptId === a.id)).toHaveLength(1);
  await service.promptScheduleStatus(context, project, a.id, { status: "active" });
  await dueSchedules();
  await processor().tick();
  runs = await service.list(context, project, "runs");
  expect(runs).toHaveLength(5);
  expect(
    (
      await f.database.query(
        "SELECT available,reserved,used FROM monitoring_credits WHERE tenant_id=$1",
        [tenant],
      )
    ).rows[0],
  ).toEqual({ available: 95, reserved: 5, used: 0 });
});
it("removes only the selected prompt, deletes empty schedules and never resurrects them", async () => {
  const a = await prompt(),
    b = await prompt();
  const shared = await service.createSchedule(context, project, { promptIds: [a.id, b.id] });
  const single = await service.createSchedule(context, project, { promptIds: [a.id] });
  await service.promptScheduleStatus(context, project, a.id, { status: "paused" });
  await service.promptScheduleStatus(context, project, a.id, { status: "deleted" });
  expect(await service.promptScheduleStatus(context, project, a.id, { status: "deleted" })).toEqual(
    { schedules: [] },
  );
  expect(await service.promptScheduleStatus(context, project, a.id, { status: "active" })).toEqual({
    schedules: [],
  });
  const schedules = await service.list(context, project, "schedules");
  expect(schedules).toHaveLength(1);
  expect(schedules[0]).toMatchObject({
    id: shared.id,
    config: { promptIds: [b.id], pausedPromptIds: [] },
  });
  expect(
    (await f.database.query("SELECT status FROM monitoring_schedules WHERE id=$1", [single.id]))
      .rows[0].status,
  ).toBe("deleted");
  await processor().tick();
  const runs = await service.list(context, project, "runs");
  expect(runs).toHaveLength(1);
  expect(runs[0]!.request).toMatchObject({ promptId: b.id });
  expect(await service.list(context, project, "prompts")).toHaveLength(2);
});
it("resuming a prompt respects schedule pauses, exhausted quotas and inactive prompts", async () => {
  const p = await prompt();
  const schedule = await service.createSchedule(context, project, { promptIds: [p.id] });
  for (const status of ["paused", "quota_paused"]) {
    await f.database.query("UPDATE monitoring_schedules SET status=$1 WHERE id=$2", [
      status,
      schedule.id,
    ]);
    await service.promptScheduleStatus(context, project, p.id, { status: "paused" });
    await service.promptScheduleStatus(context, project, p.id, { status: "active" });
    await dueSchedules();
    await processor().tick();
    expect((await service.list(context, project, "schedules"))[0]!.status).toBe(status);
    expect(await service.list(context, project, "runs")).toHaveLength(0);
  }
  await service.updatePrompt(context, project, p.id, { active: false });
  await service.scheduleStatus(context, project, String(schedule.id), { status: "active" });
  await service.promptScheduleStatus(context, project, p.id, { status: "active" });
  await processor().tick();
  expect(await service.list(context, project, "runs")).toHaveLength(0);
});
it("enforces ownership and input validation for prompt schedule changes", async () => {
  const p = await prompt();
  await service.createSchedule(context, project, { promptIds: [p.id] });
  for (const status of ["active", "paused", "deleted"]) {
    await expect(
      service.promptScheduleStatus({ userId: other, tenantId: tenantB }, projectB, p.id, {
        status,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.promptScheduleStatus(context, projectB, p.id, { status }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.promptScheduleStatus(context, project, randomUUID(), { status }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  expect(() =>
    service.promptScheduleStatus(context, project, p.id, { status: "invalid" }),
  ).toThrow();
  await expect(
    f.runtime.query("SELECT savoir_monitoring_command($1,'prompt.schedule.status',$2)", [
      project,
      { id: p.id, status: "deleted" },
    ]),
  ).rejects.toThrow();
  expect((await service.list(context, project, "schedules"))[0]!.status).toBe("active");
});

it("pauses provider quota schedules without overriding manual pauses; resumes explicitly", async () => {
  const p = await prompt();
  const schedule = await service.createSchedule(context, project, { promptIds: [p.id] });
  await processor().tick();
  vi.mocked(provider.execute).mockRejectedValue(
    new MonitoringProviderError("PROVIDER_GROUNDING_QUOTA_EXHAUSTED", false, 0, false, 429),
  );
  await processor().processNext();
  const paused = (await service.list(context, project, "schedules"))[0];
  expect(paused.status).toBe("quota_paused");
  expect(paused.config).toMatchObject({
    pausedBy: "provider_quota",
    pauseReason: "PROVIDER_GROUNDING_QUOTA_EXHAUSTED",
    promptIds: [p.id],
  });
  const run = (await service.list(context, project, "runs"))[0];
  expect(run.result).toMatchObject({
    failure: {
      category: "GROUNDING_QUOTA_EXHAUSTED",
      httpStatus: 429,
      retryable: false,
      attempts: 1,
      status: "failed",
    },
  });
  await processor().tick();
  expect(await service.list(context, project, "runs")).toHaveLength(1);
  await service.scheduleStatus(context, project, String(schedule.id), { status: "active" });
  await processor().tick();
  await service.scheduleStatus(context, project, String(schedule.id), { status: "paused" });
  await unblock();
  await processor().processNext();
  expect((await service.list(context, project, "schedules"))[0].status).toBe("paused");
});

it("bounds preflight outages across worker restarts without issuing generation calls", async () => {
  const { id } = await queue();
  for (let i = 0; i < 4; i++) {
    await f.runtime.query(
      "SELECT savoir_monitoring_preflight_result($1,'gemini','PROVIDER_PREFLIGHT_UNAVAILABLE',60)",
      [id],
    );
    await unblock();
  }
  const run = await service.detail(context, project, id);
  expect(run.status).toBe("failed");
  expect(run.attempts).toBe(0);
  expect(run.result).toMatchObject({ failure: { provider: "gemini", status: "failed" } });
  expect(provider.execute).not.toHaveBeenCalled();
});
