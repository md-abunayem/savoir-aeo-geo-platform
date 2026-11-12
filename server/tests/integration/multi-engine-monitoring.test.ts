import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { createMonitoringService } from "../../src/services/monitoring/monitoring.service.js";
import { createMonitoringProcessor } from "../../src/services/monitoring/processor.js";
import { createMultiEngineProvider } from "../../src/services/monitoring/multi-engine.provider.js";
import type {
  EvidenceStore,
  MonitoringProvider,
  MonitoringRequest,
  ProviderResult,
} from "../../src/services/monitoring/types.js";

let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let service: ReturnType<typeof createMonitoringService>;
const owner = randomUUID();
const tenant = randomUUID();
const project = randomUUID();
const context = { tenantId: tenant, userId: owner };

const evidenceStore = new Map<string, string>();
const storage: EvidenceStore = {
  put: async (k, v) => {
    if (evidenceStore.has(k)) throw new Error("immutable");
    evidenceStore.set(k, v);
  },
  get: async (k) => evidenceStore.get(k) ?? "",
};

function createMockProvider(engineName: string): MonitoringProvider {
  return {
    execute: vi.fn(async (req: MonitoringRequest): Promise<ProviderResult> => ({
      status: "succeeded",
      text: `${engineName} research answer for ${req.prompt}`,
      modelVersion: `${engineName}-v1`,
      latencyMs: 150,
      usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
      citations: [{ url: `https://${engineName}.com/source`, title: `${engineName} Citation` }],
      searchQueries: [req.prompt],
      searchEntryPoint: null,
      grounded: true,
      raw: { engine: engineName, query: req.prompt },
      estimatedCostUsd: 0.002,
      refusalReason: null,
    })),
  };
}

const geminiMock = createMockProvider("gemini");
const openAiMock = createMockProvider("openai");
const serpMock = createMockProvider("google_ai_overviews");

const multiProvider = createMultiEngineProvider({
  gemini: geminiMock,
  openai: openAiMock,
  google_ai_overviews: serpMock,
  openrouter: createMockProvider("openrouter"),
});

beforeAll(async () => {
  f = await createDatabaseFixture();

  // Seed user, tenant, membership, project, and credits
  await f.database.query(
    "INSERT INTO users(id, email, name, password_hash, email_verified_at) VALUES($1, $2, 'Owner User', 'hash', now())",
    [owner, "multi-engine-owner@example.com"],
  );
  await f.database.query("INSERT INTO tenants(id, name) VALUES($1, 'Multi Engine Tenant')", [
    tenant,
  ]);
  await f.database.query(
    "INSERT INTO memberships(tenant_id, user_id, role) VALUES($1, $2, 'owner')",
    [tenant, owner],
  );
  await f.database.query(
    "INSERT INTO projects(id, tenant_id, brand_name, domain, status) VALUES($1, $2, 'AEO Brand', 'example.com', 'active')",
    [project, tenant],
  );
  await f.database.query(
    "INSERT INTO monitoring_credits(tenant_id, available, reserved, used, minimum_interval_minutes) VALUES($1, 1000, 0, 0, 1440)",
    [tenant],
  );

  service = createMonitoringService(
    f.runtime,
    storage,
    {
      model: "gemini-2.5-flash",
      enabled: true,
      gemini: { enabled: true, model: "gemini-2.5-flash" },
      openrouter: { enabled: true, model: "google/gemma-4-31b-it:free" },
      openai: { enabled: true, model: "gpt-4o" },
      serp: { enabled: true, model: "google-ai-overview-surface" },
    },
    multiProvider,
  );
}, 180000);

afterAll(async () => {
  await f?.close();
}, 60000);

describe("Multi-Engine Monitoring Integration", () => {
  it("enqueues and schedules OpenRouter with separate provenance and provider state", async () => {
    const prompt = await service.createPrompt(context, project, {
      body: "Which products does this brand offer?",
    });
    const batch = await service.run(context, project, randomUUID(), {
      engine: "openrouter",
      promptIds: [prompt.id],
      samples: 1,
    });
    const rows = await f.database.query("SELECT request FROM monitoring_runs WHERE id=$1", [
      (batch.runIds as string[])[0],
    ]);
    expect(rows.rows[0].request).toMatchObject({
      engine: "openrouter",
      model: "google/gemma-4-31b-it:free",
      collectionMethod: "aggregator_api",
    });
    const schedule = await service.createSchedule(
      context,
      project,
      { engine: "openrouter", promptIds: [prompt.id] },
      randomUUID(),
    );
    expect((schedule.config as { engine: string }).engine).toBe("openrouter");
    expect(
      (
        await f.database.query(
          "SELECT engine FROM monitoring_provider_state WHERE engine='openrouter'",
        )
      ).rowCount,
    ).toBe(1);
    // This verifies enqueueing only; it must not leave work for later provider tests.
    await f.database.query("DELETE FROM monitoring_runs WHERE id=$1", [
      (batch.runIds as string[])[0],
    ]);
    await f.database.query(
      "UPDATE monitoring_credits SET reserved=reserved-1,available=available+1 WHERE tenant_id=$1",
      [tenant],
    );
    await service.scheduleStatus(context, project, String(schedule.id), { status: "deleted" });
  });
  it("enqueues runs for OpenAI and Google AI Overviews without collision with Gemini", async () => {
    const promptRow = (await service.createPrompt(context, project, {
      body: "Which cloud provider offers best AI inference GPUs?",
      persona: "Cloud Architect",
    })) as { id: string };

    const batchKeyOpenAI = randomUUID();
    const openAiBatch = await service.run(context, project, batchKeyOpenAI, {
      engine: "openai",
      promptIds: [promptRow.id],
      geos: ["US"],
      languages: ["en"],
      samples: 1,
    });

    const batchKeySerp = randomUUID();
    const serpBatch = await service.run(context, project, batchKeySerp, {
      engine: "google_ai_overviews",
      promptIds: [promptRow.id],
      geos: ["US"],
      languages: ["en"],
      samples: 1,
    });

    expect(openAiBatch.accepted).toBe(true);
    expect(serpBatch.accepted).toBe(true);

    const openAiRunIds = openAiBatch.runIds as string[];
    const serpRunIds = serpBatch.runIds as string[];

    expect(openAiRunIds).toHaveLength(1);
    expect(serpRunIds).toHaveLength(1);

    // Verify database entries
    const runsRes = await f.database.query(
      "SELECT id, batch_key, item_key, request FROM monitoring_runs WHERE id IN ($1, $2)",
      [openAiRunIds[0], serpRunIds[0]],
    );
    expect(runsRes.rows).toHaveLength(2);

    const openAiDb = runsRes.rows.find((r) => r.id === openAiRunIds[0]);
    const serpDb = runsRes.rows.find((r) => r.id === serpRunIds[0]);

    expect(openAiDb.item_key).toContain(":openai:");
    expect(openAiDb.request.engine).toBe("openai");
    expect(openAiDb.request.model).toBe("gpt-4o");
    expect(openAiDb.request.collectionMethod).toBe("official_api");

    expect(serpDb.item_key).toContain(":google_ai_overviews:");
    expect(serpDb.request.engine).toBe("google_ai_overviews");
    expect(serpDb.request.model).toBe("google-ai-overview-surface");
    expect(serpDb.request.collectionMethod).toBe("licensed_serp");

    // Verify credits were reserved (2 credits total)
    const credits = await f.database.query(
      "SELECT available, reserved, used FROM monitoring_credits WHERE tenant_id = $1",
      [tenant],
    );
    expect(credits.rows[0].reserved).toBe(2);
    expect(credits.rows[0].available).toBe(998);
  });

  it("claims and processes runs for different engines independently", async () => {
    // Reset spacing to ensure runs can be claimed immediately
    await f.database.query(
      "UPDATE monitoring_provider_state SET next_call_at = clock_timestamp() - interval '1 second', blocked_until = NULL",
    );

    const processor = createMonitoringProcessor(f.runtime, multiProvider, storage, {
      dailyLimit: 100,
      spacingSeconds: 1,
    });

    // Process both queued runs
    const processed1 = await processor.processNext();
    expect(processed1).toBe(true);

    await f.database.query(
      "UPDATE monitoring_provider_state SET next_call_at = clock_timestamp() - interval '1 second', blocked_until = NULL",
    );
    const processed2 = await processor.processNext();
    expect(processed2).toBe(true);

    // Verify runs completed and evidence was stored
    const completedRuns = await f.database.query(
      "SELECT id, status, result, request->>'engine' as engine FROM monitoring_runs WHERE tenant_id = $1 AND status = 'succeeded'",
      [tenant],
    );
    expect(completedRuns.rows).toHaveLength(2);

    for (const r of completedRuns.rows) {
      expect(await service.detail(context, project, r.id)).toHaveProperty("answer_processed", true);
      expect(r.result.evidenceKey).toBeDefined();
      expect(r.result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(r.result.grounded).toBe(true);
      expect(r.result.citations.length).toBeGreaterThan(0);

      // Verify immutable evidence in storage
      const rawEvidence = await storage.get(r.result.evidenceKey);
      expect(rawEvidence).toContain(r.engine);
    }

    // Verify credits committed: reserved=0, used=2, available=998
    const credits = await f.database.query(
      "SELECT available, reserved, used FROM monitoring_credits WHERE tenant_id = $1",
      [tenant],
    );
    expect(credits.rows[0].reserved).toBe(0);
    expect(credits.rows[0].used).toBe(2);
    expect(credits.rows[0].available).toBe(998);
  });

  it("performs canary test across configured engines without creating runs or burning credits", async () => {
    const key = randomUUID();
    const callsBefore = vi.mocked(openAiMock.execute).mock.calls.length;
    const canaryResult = await service.canary(context, project, "openai", key);
    const replay = await service.canary(context, project, "openai", key);
    expect(replay).toEqual(canaryResult);
    expect(vi.mocked(openAiMock.execute).mock.calls.length).toBe(callsBefore + 1);
    await expect(service.canary(context, project, "gemini", key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(canaryResult.status).toBe("succeeded");
    expect(canaryResult.engine).toBe("openai");
    expect(canaryResult.groundingObserved).toBe(true);
    expect(canaryResult.citationsCount).toBeGreaterThan(0);

    // Verify credit balance was untouched
    const credits = await f.database.query(
      "SELECT used FROM monitoring_credits WHERE tenant_id = $1",
      [tenant],
    );
    expect(credits.rows[0].used).toBe(2);
  });

  it("does not duplicate an in-flight connection test and rejects unauthorized replays", async () => {
    const key = randomUUID();
    const execute = vi.mocked(openAiMock.execute);
    const original = execute.getMockImplementation()!;
    let started!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    execute.mockImplementationOnce(async (request) => {
      started();
      await gate;
      return original(request);
    });
    const callsBefore = execute.mock.calls.length;
    const first = service.canary(context, project, "openai", key);
    try {
      await entered;
      expect(await service.canary(context, project, "openai", key)).toMatchObject({
        status: "uncertain",
        errorCode: "CONNECTION_TEST_UNCONFIRMED",
      });
      await expect(
        service.canary({ tenantId: tenant, userId: randomUUID() }, project, "openai", key),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(execute.mock.calls.length).toBe(callsBefore + 1);
    } finally {
      finish();
      await first;
    }
    expect(await service.canary(context, project, "openai", key)).toMatchObject({
      status: "succeeded",
    });
    expect(execute.mock.calls.length).toBe(callsBefore + 1);
  });

  it("respects the execution kill switch before calling a provider", async () => {
    const disabled = createMonitoringService(
      f.runtime,
      storage,
      {
        enabled: false,
        model: "fixture",
        openai: { enabled: true, model: "fixture" },
      },
      multiProvider,
    );
    const callsBefore = vi.mocked(openAiMock.execute).mock.calls.length;
    await expect(disabled.canary(context, project, "openai", randomUUID())).rejects.toMatchObject({
      code: "MONITORING_DISABLED",
    });
    expect(vi.mocked(openAiMock.execute).mock.calls.length).toBe(callsBefore);
  });

  it("tracks model changes per engine", async () => {
    // Force a model change event on finish
    const fakeRunId = randomUUID();
    const fakeLeaseId = randomUUID();

    // Seed previous model for OpenAI to test drift detection
    await f.database.query(
      "UPDATE monitoring_provider_state SET last_model = 'gpt-4o-2024-08-06' WHERE engine = 'openai'",
    );

    await f.database.query(
      "INSERT INTO monitoring_runs(id, tenant_id, project_id, batch_key, item_key, request, status, lease_id, locked_at) VALUES($1, $2, $3, 'test-batch', 'test-item', jsonb_build_object('engine', 'openai'), 'processing', $4, clock_timestamp())",
      [fakeRunId, tenant, project, fakeLeaseId],
    );
    await f.database.query(
      "UPDATE monitoring_credits SET reserved = reserved + 1 WHERE tenant_id = $1",
      [tenant],
    );

    await f.database.query(
      "SELECT savoir_monitoring_finish($1, $2, 'succeeded', jsonb_build_object('evidenceKey', 'monitoring/test', 'evidenceHash', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'modelVersion', 'gpt-4o-2026-v2'), NULL, 0)",
      [fakeRunId, fakeLeaseId],
    );

    const modelChangedEvents = await f.database.query(
      "SELECT * FROM monitoring_events WHERE tenant_id = $1 AND kind = 'engine.model_changed'",
      [tenant],
    );
    expect(modelChangedEvents.rows.length).toBeGreaterThanOrEqual(1);
    expect(modelChangedEvents.rows[0].details.engine).toBe("openai");
    expect(modelChangedEvents.rows[0].details.current).toBe("gpt-4o-2026-v2");
  });
});
