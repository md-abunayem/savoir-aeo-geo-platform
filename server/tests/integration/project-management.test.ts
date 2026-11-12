import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { createProjectManagementService } from "../../src/services/project-management.service.js";
import { TechnicalAuditService } from "../../src/services/technical/technical-audit.service.js";
let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let service: ReturnType<typeof createProjectManagementService>;
const owner = randomUUID(),
  other = randomUUID();
const input = {
  domain: "brand.test",
  brandName: "Brand",
  description: "A test brand",
  aliases: [],
  markets: [
    { country: "US", language: "en" },
    { country: "GB", language: "en" },
  ],
  competitors: [],
  prompts: [{ text: "Which brands offer this product?" }],
};
let projectId: string;
beforeAll(async () => {
  f = await createDatabaseFixture();
  await f.database.query(
    "INSERT INTO users(id,email,name,email_verified_at) VALUES($1,'selfservice@test.invalid','Owner',now()),($2,'other-selfservice@test.invalid','Other',now())",
    [owner, other],
  );
  service = createProjectManagementService(f.runtime, new TechnicalAuditService(f.runtime), {
    engines: [
      {
        engine: "gemini",
        name: "Gemini",
        model: "test-model",
        configured: true,
        requiresGrounding: true,
      },
    ],
    firecrawlConfigured: false,
    dailyCallLimit: 20,
    allowLocalTest: true,
  });
}, 60000);
afterAll(async () => {
  await f?.close();
});
it("saves once without external collection and returns the same project on retry", async () => {
  const key = randomUUID();
  const created = await service.create(owner, key, input);
  projectId = created.projectId;
  expect(await service.create(owner, key, input)).toEqual(created);
  const detail = await service.detail(owner, projectId);
  expect(detail.project.brandName).toBe("Brand");
  expect(detail.prompts).toHaveLength(1);
  expect(detail.runs).toHaveLength(0);
  expect(detail.schedules).toHaveLength(0);
  expect((await service.summaries(owner))[projectId]).toEqual({
    lastRunAt: null,
    lastAuditStatus: null,
    lastAuditScore: null,
  });
  expect(await service.summaries(other)).toEqual({});
  await expect(
    service.create(owner, key, { ...input, brandName: "Different" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(service.create(owner, randomUUID(), input)).rejects.toMatchObject({
    code: "PROJECT_DOMAIN_EXISTS",
  });
});
it("rejects another account on detail, update, launch and archive", async () => {
  await expect(service.detail(other, projectId)).rejects.toMatchObject({ statusCode: 404 });
  await expect(service.status(other, projectId, "archived")).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(
    service.launch(other, projectId, randomUUID(), { mode: "once", engines: ["gemini"] }),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(service.update(other, projectId, {})).rejects.toMatchObject({ statusCode: 404 });
});
it("launches one run per market and does not charge twice on retry", async () => {
  const key = randomUUID();
  const payload = { mode: "once", engines: ["gemini"], samples: 1 };
  const first = await service.launch(owner, projectId, key, payload);
  expect(first.runIds).toHaveLength(2);
  expect(await service.launch(owner, projectId, key, payload)).toEqual(first);
  const detail = await service.detail(owner, projectId);
  expect(detail.runs).toHaveLength(2);
  expect(detail.credits.reserved).toBe(2);
  await expect(
    service.launch(owner, projectId, key, { ...payload, samples: 2 }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    service.launch(owner, projectId, randomUUID(), { mode: "once", engines: ["openai"] }),
  ).rejects.toMatchObject({ code: "ENGINE_NOT_CONFIGURED" });
});
it("updates saved prompts and markets, replaces schedules, and pauses on archive", async () => {
  let detail = await service.detail(owner, projectId);
  await service.update(owner, projectId, {
    brandName: "Updated Brand",
    description: "Updated",
    aliases: ["UB"],
    markets: [{ country: "CA", language: "en" }],
    competitors: [],
    prompts: detail.prompts.map((p) => ({
      id: p.id,
      body: "Which brands are suitable for Canada?",
      active: true,
    })),
  });
  const key = randomUUID();
  const payload = { mode: "schedule", engines: ["gemini"], cadence: "weekly", samples: 2 };
  await service.launch(owner, projectId, key, payload);
  await service.launch(owner, projectId, key, payload);
  detail = await service.detail(owner, projectId);
  expect(detail.schedules).toHaveLength(1);
  expect(detail.schedules[0].config.geos).toEqual(["CA"]);
  expect(detail.schedules[0].config.intervalMinutes).toBe(10080);
  await service.status(owner, projectId, "archived");
  detail = await service.detail(owner, projectId);
  expect(detail.project.status).toBe("archived");
  expect(detail.schedules[0].status).toBe("paused");
  expect(detail.runs).toHaveLength(2);
  await expect(service.launch(owner, projectId, randomUUID(), payload)).rejects.toMatchObject({
    code: "PROJECT_NOT_ACTIVE",
  });
  expect((await f.runtime.query("SELECT * FROM project_launch_requests")).rows).toHaveLength(0);
});
it("preserves inactive new prompts and rejects crawl-only recurring monitoring", async () => {
  const detail = await service.detail(owner, projectId);
  const updated = await service.update(owner, projectId, {
    brandName: "Updated Brand",
    description: "Updated",
    aliases: [],
    markets: [{ country: "CA", language: "en" }],
    competitors: [],
    prompts: [
      ...detail.prompts.map((p) => ({ id: p.id, body: p.body, active: p.active })),
      { body: "Keep this prompt for later", active: false },
    ],
  });
  expect(updated.prompts.find((p) => p.body === "Keep this prompt for later")?.active).toBe(false);
  await expect(
    service.launch(owner, projectId, randomUUID(), { mode: "schedule", engines: [], crawl: true }),
  ).rejects.toThrow("Select an AI engine to schedule monitoring");
});
