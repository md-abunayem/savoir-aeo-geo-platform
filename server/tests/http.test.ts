import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/config/logger.js";

const ready = { ready: true, checks: { database: "up", redis: "up", storage: "up" } } as const;
const app = createApp({
  origins: ["http://localhost:3000"],
  logger: createLogger("silent"),
  readiness: async () => ready,
});

describe("HTTP boundary", () => {
  it("returns liveness and a generated request id without advertising Express", async () => {
    const response = await request(app).get("/v1/health/live").set("X-Request-Id", "untrusted");
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.headers["x-request-id"]).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
  it("returns RFC problem details for missing resources", async () => {
    const response = await request(app).get("/v1/projects");
    expect(response.status).toBe(404);
    expect(response.type).toBe("application/problem+json");
    expect(response.body).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(response.body.stack).toBeUndefined();
  });
  it("logs unexpected server errors by request id without exposing details to clients", async () => {
    const logger = createLogger("silent");
    const errorLog = vi.spyOn(logger, "error");
    const failingApp = createApp({
      origins: [],
      logger,
      readiness: async () => ready,
      billing: {
        handleWebhook: async () => {
          throw new Error("private diagnostic detail");
        },
      } as never,
      ledger: {} as never,
    });

    const response = await request(failingApp)
      .post("/v1/billing/webhook")
      .set("stripe-signature", "test")
      .send({});
    expect(response.status).toBe(500);
    expect(response.body.detail).toBe("An unexpected error occurred");
    expect(JSON.stringify(response.body)).not.toContain("private diagnostic detail");
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: response.body.requestId,
        errorName: "Error",
      }),
      "unhandled request error",
    );
    expect(JSON.stringify(errorLog.mock.calls[0])).not.toContain("private diagnostic detail");
  });
  it("rejects disallowed browser origins", async () => {
    const response = await request(app)
      .get("/v1/health/live")
      .set("Origin", "https://attacker.invalid");
    expect(response.status).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("allows configured credentialed preflight", async () => {
    const response = await request(app)
      .options("/v1/health/live")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
  it("maps malformed JSON and oversized input without leaking parser details", async () => {
    const malformed = await request(app)
      .post("/v1/projects")
      .set("Content-Type", "application/json")
      .send('{"private":"secret"');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("INVALID_JSON");
    expect(JSON.stringify(malformed.body)).not.toContain("secret");
    const oversized = await request(app)
      .post("/v1/projects")
      .send({ value: "a".repeat(1024 * 1024) });
    expect(oversized.status).toBe(413);
  });
  it("returns unavailable when dependencies are down or draining", async () => {
    for (const draining of [false, true]) {
      const unavailable = createApp({
        origins: [],
        logger: createLogger("silent"),
        readiness: async () => ({
          ready: false,
          checks: { database: "down", redis: "up", storage: "up" },
        }),
        draining: () => draining,
      });
      const response = await request(unavailable).get("/v1/health/ready");
      expect(response.status).toBe(503);
      expect(response.body.data).toEqual({ status: "not_ready" });
    }
  });
  it("serves readiness and the versioned API contract", async () => {
    expect((await request(app).get("/v1/health/ready")).status).toBe(200);
    expect((await request(app).get("/v1/openapi.json")).body.openapi).toBe("3.1.0");
  });
});
