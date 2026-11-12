import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createDatabaseFixture } from "./database-fixture.js";
import { createProjectService } from "../../src/services/project.service.js";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/config/logger.js";
let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let service: ReturnType<typeof createProjectService>;
const owner = randomUUID(),
  other = randomUUID(),
  unverified = randomUUID(),
  disabled = randomUUID(),
  tenant = randomUUID(),
  tenantB = randomUUID();
beforeAll(async () => {
  f = await createDatabaseFixture();
  service = createProjectService(f.runtime);
  await f.database.query(
    "INSERT INTO users(id,name,email,email_verified_at,disabled_at) VALUES($1,'Owner','project-owner@test.invalid',now(),NULL),($2,'Other','project-other@test.invalid',now(),NULL),($3,'Unverified','project-unverified@test.invalid',NULL,NULL),($4,'Disabled','project-disabled@test.invalid',now(),now())",
    [owner, other, unverified, disabled],
  );
  await f.database.query(
    "INSERT INTO tenants(id,name) VALUES($1,'Owned workspace'),($2,'Other workspace')",
    [tenant, tenantB],
  );
  await f.database.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner'),($1,$5,'owner'),($1,$6,'owner'),($1,$4,'viewer')",
    [tenant, owner, tenantB, other, unverified, disabled],
  );
  await f.database.query(
    "INSERT INTO projects(tenant_id,brand_name,domain,status) VALUES($1,'Owned A','a.test','active'),($1,'Owned B','b.test','draft'),($2,'Private B','private.test','active')",
    [tenant, tenantB],
  );
}, 60000);
afterAll(async () => {
  await f?.close();
});
it("discovers only verified active-account Owner projects without weakening table RLS", async () => {
  const a = await service.list(owner, {});
  expect(a.projects).toHaveLength(2);
  expect(a.projects.every((p) => p.tenantId === tenant)).toBe(true);
  const b = await service.list(other, {});
  expect(b.projects).toHaveLength(1);
  expect(b.projects[0]?.tenantId).toBe(tenantB);
  expect((await service.list(unverified, {})).projects).toHaveLength(0);
  expect((await service.list(disabled, {})).projects).toHaveLength(0);
  expect((await service.list(randomUUID(), {})).projects).toHaveLength(0);
  expect((await f.runtime.query("SELECT * FROM projects")).rowCount).toBe(0);
});
it("paginates consistently and rejects attempts to supply a different identity", async () => {
  const first = await service.list(owner, { limit: 1 });
  expect(first.nextCursor).toBe(first.projects[0]?.id);
  const second = await service.list(owner, { limit: 1, after: first.nextCursor });
  expect(second.projects).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(second.projects[0]?.id).not.toBe(first.projects[0]?.id);
  await expect(service.list(owner, { userId: other })).rejects.toThrow();
  await expect(service.list(owner, { limit: 1000 })).rejects.toThrow();
});
it("requires a session, uses server identity and documents the project contract", async () => {
  const app = createApp({
    origins: [],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    projects: service,
    auth: {
      service: {
        authenticate: async () => ({
          id: owner,
          name: "Owner",
          email: "project-owner@test.invalid",
        }),
        login: vi.fn(),
        refresh: vi.fn(),
        logout: vi.fn(),
      },
      limiter: { consume: async () => ({ allowed: true, retryAfter: 1 }) },
      csrfSecret: "c".repeat(64),
      secureCookies: false,
    },
  });
  expect((await request(app).get("/v1/projects")).status).toBe(401);
  const response = await request(app).get("/v1/projects").set("Cookie", "savoir_access=fixture");
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body.data.projects).toHaveLength(2);
  expect(
    (
      await request(app)
        .get("/v1/projects?userId=" + other)
        .set("Cookie", "savoir_access=fixture")
    ).status,
  ).toBe(400);
  expect((await request(app).get("/v1/openapi.json")).body.paths["/v1/projects"]).toBeDefined();
});
