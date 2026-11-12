import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { withTenantClient } from "../../src/db/tenant.js";
import { QaService } from "../../src/services/intelligence/qa.service.js";
import type { QaClassifier } from "../../src/services/intelligence/qa-classifier.service.js";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let service: QaService;
const userId = randomUUID(),
  otherUser = randomUUID(),
  tenantId = randomUUID(),
  otherTenant = randomUUID();
const projectId = randomUUID(),
  otherProject = randomUUID(),
  siblingProject = randomUUID();
const classifier: QaClassifier = {
  classify: async (questions) =>
    questions.map(() => ({
      intent: "decision",
      recommendedFormats: ["Case Study", "Demo Script"],
    })),
};

beforeAll(async () => {
  fixture = await createDatabaseFixture();
  await fixture.database.query(
    "INSERT INTO users(id,name,email) VALUES($1,'QA owner','qa-owner@test.invalid'),($2,'Other','qa-other@test.invalid')",
    [userId, otherUser],
  );
  await fixture.database.query("INSERT INTO tenants(id,name) VALUES($1,'QA'),($2,'Other QA')", [
    tenantId,
    otherTenant,
  ]);
  await fixture.database.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')",
    [tenantId, userId, otherTenant, otherUser],
  );
  await fixture.database.query(
    "INSERT INTO projects(id,tenant_id,brand_name,domain) VALUES($1,$2,'QA','qa.test'),($3,$4,'Other','other-qa.test'),($5,$2,'Sibling','sibling-qa.test')",
    [projectId, tenantId, otherProject, otherTenant, siblingProject],
  );
  service = new QaService(fixture.runtime, classifier);
});
afterAll(async () => {
  await fixture?.close();
});

describe("Q&A migration, retrieval and tenant isolation", () => {
  it("imports, prioritizes and deduplicates real persisted questions", async () => {
    const input = [
      { source: "faq", questionText: "Can I get a demo?", demandScore: 90, businessPriority: 80 },
      {
        source: "survey",
        questionText: "Is there an annual plan?",
        demandScore: 10,
        businessPriority: 100,
      },
    ];
    expect(await service.ingest(userId, projectId, input)).toMatchObject({
      imported: 2,
      duplicates: 0,
    });
    expect(await service.ingest(userId, projectId, input)).toMatchObject({
      imported: 0,
      duplicates: 2,
    });
    const result = await service.opportunities(userId, projectId, { limit: 1 });
    expect(result.questions[0]).toMatchObject({
      questionText: "Can I get a demo?",
      priorityScore: 86,
      intent: "decision",
      recommendedFormats: ["Case Study", "Demo Script"],
    });
    expect(result.nextOffset).toBe(1);
    const next = await service.opportunities(userId, projectId, { limit: 1, offset: 1 });
    expect(next.questions[0]?.source).toBe("survey");
    expect(next.nextOffset).toBeNull();
    expect((await service.opportunities(userId, siblingProject, {})).questions).toHaveLength(0);
  });

  it("hides questions without tenant context and denies foreign project access", async () => {
    expect((await fixture.runtime.query("SELECT * FROM customer_questions")).rows).toHaveLength(0);
    await expect(service.opportunities(otherUser, projectId, {})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      service.ingest(userId, otherProject, [{ source: "faq", questionText: "Why buy?" }]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a project/tenant mismatch and out-of-range scores at the database boundary", async () => {
    const insert = (targetProject: string, demand: number) =>
      withTenantClient(fixture.runtime, { userId, tenantId }, (client) =>
        client.query(
          `INSERT INTO customer_questions(tenant_id,project_id,source,question_text,question_hash,intent,demand_score)
       VALUES($1,$2,'faq','Why buy?',$3,'decision',$4)`,
          [tenantId, targetProject, randomUUID(), demand],
        ),
      );
    await expect(insert(otherProject, 50)).rejects.toMatchObject({ code: "42501" });
    await expect(insert(projectId, 101)).rejects.toMatchObject({ code: "23514" });
  });

  it("uses the unique constraint to safely handle concurrent duplicate imports", async () => {
    const input = [{ source: "reddit", questionText: "Can we book an enterprise demo?" }];
    const results = await Promise.all([
      service.ingest(userId, projectId, input),
      service.ingest(userId, projectId, input),
    ]);
    expect(results.reduce((sum, result) => sum + result.imported, 0)).toBe(1);
    expect(
      (await service.opportunities(userId, projectId, { source: "reddit" })).questions,
    ).toHaveLength(1);
  });

  it("keeps all rows out when classification fails", async () => {
    const failing = new QaService(fixture.runtime, {
      classify: async () => {
        throw new Error("classification failed");
      },
    });
    await expect(
      failing.ingest(userId, siblingProject, [
        { source: "survey", questionText: "How much does this cost?" },
      ]),
    ).rejects.toThrow();
    expect((await service.opportunities(userId, siblingProject, {})).questions).toHaveLength(0);
  });
});
