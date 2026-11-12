/** Disposable browser QA server. No production data or provider calls. Run from server/. */
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { createDatabaseFixture } from "./integration/database-fixture.js";
import { createAuthService } from "../src/services/auth.service.js";
import { createProjectService } from "../src/services/project.service.js";
import { createMonitoringService } from "../src/services/monitoring/monitoring.service.js";
import { createMonitoringProcessor } from "../src/services/monitoring/processor.js";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/config/logger.js";
if (process.env.NODE_ENV === "production") throw new Error("Preview fixtures are local only");
const f = await createDatabaseFixture();
const userId = randomUUID(),
  tenantId = randomUUID(),
  projectId = randomUUID();
try {
  await f.database.query(
    "INSERT INTO users(id,name,email,email_verified_at,password_hash) VALUES($1,'Preview Owner','frontend-test@test.invalid',now(),$2)",
    [userId, await bcrypt.hash("Savoir-local-test-2026!", 12)],
  );
  await f.database.query("INSERT INTO tenants(id,name) VALUES($1,'Integration test workspace')", [
    tenantId,
  ]);
  await f.database.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [
    tenantId,
    userId,
  ]);
  await f.database.query(
    "INSERT INTO projects(id,tenant_id,brand_name,domain,status) VALUES($1,$2,'Preview Brand','example.test','active')",
    [projectId, tenantId],
  );
  await f.database.query("INSERT INTO monitoring_credits(tenant_id,available) VALUES($1,100)", [
    tenantId,
  ]);
  const values = new Map<string, string>();
  const storage = {
    put: async (k: string, v: string) => {
      values.set(k, v);
    },
    get: async (k: string) => values.get(k) ?? "",
  };
  const seed = createMonitoringService(f.runtime, storage, { model: "fixture", enabled: true });
  const context = { tenantId, userId };
  const prompt = await seed.createPrompt(context, projectId, {
    body: "Which brands help teams understand AI search?",
    persona: "A marketing team",
  });
  await seed.createSchedule(context, projectId, { promptIds: [prompt.id] });
  await seed.run(context, projectId, randomUUID(), { promptIds: [prompt.id], samples: 1 });
  await createMonitoringProcessor(
    f.runtime,
    {
      execute: async () => ({
        status: "succeeded",
        text: "This is a synthetic answer used only to verify the frontend. It is not a provider result.",
        modelVersion: "fixture-v1",
        latencyMs: 12,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        citations: [],
        searchQueries: [],
        searchEntryPoint: null,
        grounded: false,
        raw: { fixture: true },
        estimatedCostUsd: null,
        refusalReason: null,
      }),
    },
    storage,
    { dailyLimit: 100, spacingSeconds: 1 },
  ).processNext();
  const app = createApp({
    origins: ["http://localhost:3000"],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    projects: createProjectService(f.runtime),
    monitoring: createMonitoringService(f.runtime, storage, { model: "fixture", enabled: true }),
    auth: {
      service: await createAuthService(f.runtime, "preview-auth-".repeat(6)),
      limiter: { consume: async () => ({ allowed: true, retryAfter: 1 }) },
      csrfSecret: "preview-csrf-".repeat(6),
      secureCookies: false,
    },
  });
  const server = app.listen(8001, "127.0.0.1", () =>
    console.log("Disposable preview API ready on 127.0.0.1:8001. Type stop to clean up."),
  );
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
    process.exit(0);
  }
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (line.trim() === "stop") void stop();
  });
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  setTimeout(() => void stop(), 60 * 60 * 1000).unref();
} catch (error) {
  await f.close();
  throw error;
}
