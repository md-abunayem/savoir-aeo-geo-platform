import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { ApprovalService } from "../../src/services/publishing/approval.service.js";
import { studioDocument } from "../studio-fixtures.js";
import { withTenantClient } from "../../src/db/tenant.js";
let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let service: ApprovalService;
const owner = randomUUID(),
  other = randomUUID(),
  tenant = randomUUID(),
  otherTenant = randomUUID(),
  project = randomUUID(),
  otherProject = randomUUID();
beforeAll(async () => {
  fixture = await createDatabaseFixture();
  await fixture.database.query(
    "INSERT INTO users(id,name,email) VALUES($1,'Publisher','publisher@test.invalid'),($2,'Other','other-publisher@test.invalid')",
    [owner, other],
  );
  await fixture.database.query(
    "INSERT INTO tenants(id,name) VALUES($1,'Publish'),($2,'Other publish')",
    [tenant, otherTenant],
  );
  await fixture.database.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')",
    [tenant, owner, otherTenant, other],
  );
  await fixture.database.query(
    "INSERT INTO projects(id,tenant_id,brand_name,domain) VALUES($1,$2,'Publish','publisher.test'),($3,$4,'Other','other-publisher.test')",
    [project, tenant, otherProject, otherTenant],
  );
  service = new ApprovalService(
    fixture.runtime,
    { enabled: true, tokenKey: "01".repeat(32), model: "test" },
    {} as never,
  );
  vi.spyOn(service, "verify").mockResolvedValue({
    passed: true,
    flaggedClaims: [],
    suggestions: [],
  });
});
afterAll(async () => {
  await fixture?.close();
});
describe("publishing storage, approvals and durable outbox", () => {
  it("saves unapproved drafts and rejects foreign project reads", async () => {
    const row = await service.create(owner, project, { ...studioDocument(), brand_id: project });
    expect(row.status).toBe("draft");
    expect(row.validation).toBeNull();
    expect((await fixture.runtime.query("SELECT * FROM studio_drafts")).rows).toHaveLength(0);
    await expect(service.list(other, project)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("locks exact approved revisions, persists delivery jobs and discovers due outbox IDs", async () => {
    const row = await service.create(owner, project, { ...studioDocument(), brand_id: project });
    await service.review(owner, project, row.id, 1);
    await service.approve(owner, project, row.id, 1);
    await withTenantClient(fixture.runtime, { userId: owner, tenantId: tenant }, (client) =>
      client.query(
        "INSERT INTO publishing_connections(tenant_id,project_id,provider,encrypted_credentials,channels) VALUES($1,$2,'buffer','opaque',$3) ON CONFLICT(project_id,provider) DO NOTHING",
        [tenant, project, JSON.stringify([{ id: "channel", platform: "x", name: "Brand" }])],
      ),
    );
    const result = await service.schedule(owner, project, row.id, {
      revision: 1,
      scheduledTime: new Date(Date.now() + 45000).toISOString(),
      targets: [{ platform: "x", channelId: "channel" }],
    });
    expect(result.status).toBe("scheduled");
    await expect(
      service.edit(owner, project, row.id, 1, { ...studioDocument(), brand_id: project }),
    ).rejects.toMatchObject({ code: "STUDIO_CONFLICT" });
    const due = await fixture.runtime.query("SELECT * FROM savoir_publishing_due()");
    expect(due.rows).toContainEqual(
      expect.objectContaining({ project_id: project, user_id: owner, tenant_id: tenant }),
    );
  });
  it("editing an approved draft invalidates its stored human approval", async () => {
    const document = { ...studioDocument(), brand_id: project };
    const row = await service.create(owner, project, document);
    await service.review(owner, project, row.id, 1);
    await service.approve(owner, project, row.id, 1);
    const result = await service.edit(owner, project, row.id, 1, document);
    expect(result).toMatchObject({
      revision: 2,
      status: "draft",
      approved_revision: null,
      approved_by: null,
      validation: null,
    });
  });
});
