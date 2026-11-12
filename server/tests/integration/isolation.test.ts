import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../../src/db/tenant.js";
import { projects } from "../../src/db/schema.js";
import { createDatabaseFixture } from "./database-fixture.js";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
const userA = randomUUID(),
  userB = randomUUID(),
  tenantA = randomUUID(),
  tenantB = randomUUID();
const projectA = randomUUID(),
  projectB = randomUUID();
const migrationJournal = JSON.parse(
  readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: unknown[] };

beforeAll(async () => {
  fixture = await createDatabaseFixture();
  await fixture.database.query(
    "INSERT INTO users (id,name,email) VALUES ($1,'A','a@test.invalid'),($2,'B','b@test.invalid')",
    [userA, userB],
  );
  await fixture.database.query("INSERT INTO tenants (id,name) VALUES ($1,'A'),($2,'B')", [
    tenantA,
    tenantB,
  ]);
  await fixture.database.query(
    "INSERT INTO memberships (tenant_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner')",
    [tenantA, userA, tenantB, userB],
  );
  await fixture.database.query(
    "INSERT INTO projects (id,tenant_id,brand_name,domain) VALUES ($1,$2,'A','a.test'),($3,$4,'B','b.test')",
    [projectA, tenantA, projectB, tenantB],
  );
});
afterAll(async () => {
  await fixture?.close();
});
describe("tenant isolation in a disposable database", () => {
  it("applies all migrations and hides data without tenant context", async () => {
    expect((await fixture.runtime.query("SELECT * FROM projects")).rows).toHaveLength(0);
    expect(
      (await fixture.database.query("SELECT * FROM drizzle.__drizzle_migrations")).rowCount,
    ).toBe(migrationJournal.entries.length);
  });
  it("returns only the authenticated owner's tenant rows", async () => {
    const result = await withTenant(fixture.runtime, { userId: userA, tenantId: tenantA }, (db) =>
      db.select().from(projects),
    );
    expect(result.map((row) => row.id)).toEqual([projectA]);
  });
  it("rejects a forged tenant selection", async () => {
    await expect(
      withTenant(fixture.runtime, { userId: userA, tenantId: tenantB }, (db) =>
        db.select().from(projects),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("rejects cross-tenant writes and clears transaction context after failure", async () => {
    await expect(
      withTenant(fixture.runtime, { userId: userA, tenantId: tenantA }, (db) =>
        db
          .insert(projects)
          .values({ tenantId: tenantB, brandName: "Injected", domain: "bad.test" }),
      ),
    ).rejects.toThrow();
    expect((await fixture.runtime.query("SELECT * FROM projects")).rows).toHaveLength(0);
    const result = await withTenant(fixture.runtime, { userId: userB, tenantId: tenantB }, (db) =>
      db.select().from(projects),
    );
    expect(result.map((row) => row.id)).toEqual([projectB]);
    expect((await fixture.runtime.query("SELECT * FROM projects")).rows).toHaveLength(0);
  });
  it("rejects privileged connections", async () => {
    await expect(
      withTenant(fixture.database, { userId: userA, tenantId: tenantA }, (db) =>
        db.select().from(projects),
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_DATABASE_ROLE" });
  });
});
