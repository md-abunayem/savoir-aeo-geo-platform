import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { createTenantQueryPool, runWithTenantContext } from "../../src/db/tenant-query.js";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/config/logger.js";
import type { AuthService } from "../../src/services/auth.service.js";
import { AnswerService } from "../../src/services/answer/answer.service.js";
import { VisibilityService } from "../../src/services/analytics/visibility.service.js";
import { CitationService } from "../../src/services/analytics/citation.service.js";
import { CompetitorService } from "../../src/services/analytics/competitor.service.js";
import { AxoService } from "../../src/services/axo/axo.service.js";
import { ContentService } from "../../src/services/content/content.service.js";
import { ActionCenterService } from "../../src/services/action-center/action-center.service.js";
import { IntegrationsService } from "../../src/services/integrations/integrations.service.js";
import { TrafficAnalyticsService } from "../../src/services/integrations/traffic-analytics.service.js";
import { ExecutiveDashboardService } from "../../src/services/reporting/executive-dashboard.service.js";
import { AlertEngineService } from "../../src/services/reporting/alert-engine.service.js";
import { ReportGeneratorService } from "../../src/services/reporting/report-generator.service.js";
import { BillingService } from "../../src/services/billing/billing.service.js";
import { StripeAdapter } from "../../src/services/billing/stripe.adapter.js";
import { GoogleSync } from "../../src/services/integrations/google-sync.js";
import { TokenCrypto } from "../../src/services/integrations/token-crypto.js";
import { ApiKeyService } from "../../src/services/integrations/api-key.service.js";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let app: ReturnType<typeof createApp>;
let pool: ReturnType<typeof createTenantQueryPool>;
const userId = randomUUID(),
  otherUserId = randomUUID();
const tenantId = randomUUID(),
  otherTenantId = randomUUID();
const projectId = randomUUID(),
  otherProjectId = randomUUID();
const context = { userId, tenantId };
const endpoints = [
  "answers",
  "visibility",
  "visibility/trend",
  "visibility/anomalies",
  "citations",
  "competitors",
  "axo/policy",
  "content/inventory",
  "content/gaps",
  "content/briefs",
  "actions",
  "integrations/connections",
  "integrations/traffic/overview",
  "reporting/dashboard",
  "reporting/alerts/rules",
  "reporting/alerts/incidents",
  "reporting/schedules",
  "reporting/reports",
];

beforeAll(async () => {
  fixture = await createDatabaseFixture();
  await fixture.database.query(
    "INSERT INTO users(id,name,email) VALUES($1,'Owner','workspace@test.invalid'),($2,'Other','other-workspace@test.invalid')",
    [userId, otherUserId],
  );
  await fixture.database.query("INSERT INTO tenants(id,name) VALUES($1,'Workspace'),($2,'Other')", [
    tenantId,
    otherTenantId,
  ]);
  await fixture.database.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')",
    [tenantId, userId, otherTenantId, otherUserId],
  );
  await fixture.database.query(
    "INSERT INTO projects(id,tenant_id,brand_name,domain) VALUES($1,$2,'Workspace','workspace.test'),($3,$4,'Other','other.test')",
    [projectId, tenantId, otherProjectId, otherTenantId],
  );
  pool = createTenantQueryPool(fixture.runtime);
  // Authentication is stubbed; database access and RLS use the real restricted role.
  app = createApp({
    auth: {
      service: {
        authenticate: async () => ({ id: userId, name: "Owner" }),
      } as unknown as AuthService,
      limiter: { consume: async () => ({ allowed: true, retryAfter: 1 }) },
      csrfSecret: "s".repeat(64),
      secureCookies: false,
    },
    answers: new AnswerService(pool),
    visibility: new VisibilityService(pool),
    citations: new CitationService(pool),
    competitors: new CompetitorService(pool),
    axo: new AxoService(pool),
    content: new ContentService(pool),
    actions: new ActionCenterService(pool),
    integrations: new IntegrationsService(pool),
    apiKeys: new ApiKeyService(fixture.runtime, {
      consume: async () => ({ allowed: true, retryAfter: 1 }),
    }),
    traffic: new TrafficAnalyticsService(pool),
    dashboard: new ExecutiveDashboardService(pool),
    alerts: new AlertEngineService(pool),
    reports: new ReportGeneratorService(pool),
    origins: ["http://localhost:3000"],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
  });
});

afterAll(async () => {
  await fixture?.close();
});

describe("workspace sections with the restricted runtime database role", () => {
  it("enforces public API key project, scope, expiry, and revocation", async () => {
    const key = TokenCrypto.generateApiKey();
    const keyId = randomUUID();
    await fixture.database.query(
      "INSERT INTO tenant_api_keys(id,tenant_id,project_id,name,key_prefix,key_hash,scopes) VALUES($1,$2,$3,'Test key',$4,$5,'[\"read:traffic\"]'::jsonb)",
      [keyId, tenantId, projectId, key.keyPrefix, key.keyHash],
    );
    const read = (project: string, path = "traffic") =>
      request(app)
        .get(`/v1/public/projects/${project}/${path}`)
        .set("Authorization", "Bearer " + key.secretKey);
    expect((await read(projectId)).status).toBe(401);
    await fixture.database.query("UPDATE projects SET status='active' WHERE id=$1", [projectId]);
    expect((await read(projectId)).status).toBe(200);
    expect((await read(otherProjectId)).status).toBe(401);
    expect((await read(projectId, "actions")).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`/v1/public/projects/${projectId}/actions`)
          .set("Authorization", "Bearer " + key.secretKey)
          .send({})
      ).status,
    ).toBe(404);
    await fixture.database.query(
      "UPDATE tenant_api_keys SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [keyId],
    );
    expect((await read(projectId)).status).toBe(401);
    await fixture.database.query(
      "UPDATE tenant_api_keys SET expires_at=NULL,scopes='[\"read:actions\"]'::jsonb WHERE id=$1",
      [keyId],
    );
    expect((await read(projectId, "actions")).status).toBe(200);
    await fixture.database.query("UPDATE tenant_api_keys SET revoked_at=now() WHERE id=$1", [
      keyId,
    ]);
    expect((await read(projectId, "actions")).status).toBe(401);
  });
  it("initializes billing under owner context and rejects another tenant", async () => {
    const service = new BillingService(fixture.runtime, new StripeAdapter());
    const overview = await service.forOwner(tenantId, userId, (billing) =>
      billing.getBillingOverview(tenantId),
    );
    expect(overview.subscription.planTier).toBe("starter");
    await expect(
      service.forOwner(otherTenantId, userId, (billing) =>
        billing.getBillingOverview(otherTenantId),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("replaces Google facts without duplicating repeated syncs", async () => {
    const key = Buffer.alloc(32, 2);
    const connectionId = randomUUID();
    await fixture.database.query(
      "INSERT INTO integration_connections(id,tenant_id,project_id,provider,property_id,encrypted_tokens) VALUES($1,$2,$3,'google_search_console','sc-domain:workspace.test',$4)",
      [connectionId, tenantId, projectId, TokenCrypto.encrypt({ access_token: "test" }, key)],
    );
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          rows: [
            {
              keys: ["how does this work", "https://workspace.test/", day, "DESKTOP", "usa"],
              impressions: 10,
              clicks: 2,
              ctr: 0.2,
              position: 1.5,
            },
          ],
        }),
      );
    const sync = new GoogleSync(fixture.runtime, key, {}, fetcher);
    for (let attempt = 0; attempt < 2; attempt++)
      await runWithTenantContext(context, () =>
        sync.sync(projectId, tenantId, connectionId, "google_search_console"),
      );
    const facts = await fixture.database.query(
      "SELECT * FROM gsc_performance_facts WHERE project_id=$1",
      [projectId],
    );
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0].clicks).toBe(2);
  });
  it("rejects requests without a signed-in session", async () => {
    const response = await request(app).get(
      `/v1/tenants/${tenantId}/projects/${projectId}/content/inventory`,
    );
    expect(response.status).toBe(401);
  });

  it("generates a report from the project's stored data with the runtime role", async () => {
    const result = await runWithTenantContext(context, () =>
      new ReportGeneratorService(pool).generateReport(projectId, tenantId, { format: "html" }),
    );
    expect(result.report.status).toBe("completed");
    expect(result.htmlContent).toContain("Workspace");
    expect(result.report.projectId).toBe(projectId);
  });

  it.each(endpoints)("loads %s for an authenticated owner", async (endpoint) => {
    const response = await request(app)
      .get(`/v1/tenants/${tenantId}/projects/${projectId}/${endpoint}`)
      .set("Cookie", "savoir_access=test-session");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it.each([
    "visibility",
    "content/inventory",
    "actions",
    "integrations/traffic/overview",
    "reporting/dashboard",
  ])("rejects another tenant in %s", async (endpoint) => {
    const response = await request(app)
      .get(`/v1/tenants/${otherTenantId}/projects/${otherProjectId}/${endpoint}`)
      .set("Cookie", "savoir_access=test-session");
    expect(response.status).toBe(404);
  });

  it("does not leak context between concurrent tenants or reused connections", async () => {
    const other = { userId: otherUserId, tenantId: otherTenantId };
    const results = await Promise.all(
      [context, other, context, other].map((ctx) =>
        runWithTenantContext(ctx, () => pool.query("SELECT id FROM projects")),
      ),
    );
    expect(results.map((result) => result.rows.map((row) => row.id))).toEqual([
      [projectId],
      [otherProjectId],
      [projectId],
      [otherProjectId],
    ]);
    expect((await fixture.runtime.query("SELECT id FROM projects")).rows).toEqual([]);
    await expect(pool.query("SELECT id FROM projects")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("allows owned content writes but prevents foreign-tenant writes", async () => {
    const insert = (tenant: string, project: string) =>
      pool.query(
        "INSERT INTO content_items(tenant_id,project_id,url,path) VALUES($1,$2,'https://workspace.test/page','/page') RETURNING id",
        [tenant, project],
      );
    const result = await runWithTenantContext(context, () => insert(tenantId, projectId));
    expect(result.rowCount).toBe(1);
    await expect(
      runWithTenantContext(context, () => insert(otherTenantId, otherProjectId)),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
