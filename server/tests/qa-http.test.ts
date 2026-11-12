import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/config/logger.js";
import { QaService } from "../src/services/intelligence/qa.service.js";
import { ApiError } from "../src/utils/ApiError.js";
import { parseQaIngestion } from "../src/validations/qa.validation.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const path = `/v1/projects/${projectId}/qa`;
function setup() {
  const ingest = vi.fn(async (_user: string, _project: string, input: unknown) => ({
    received: parseQaIngestion(input).length,
    imported: 1,
    duplicates: 0,
    questions: [],
  }));
  const opportunities = vi.fn().mockResolvedValue({ questions: [], nextOffset: null });
  const consume = vi.fn().mockResolvedValue({ allowed: true, retryAfter: 10 });
  const app = createApp({
    origins: [],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    qa: { ingest, opportunities } as unknown as QaService,
    auth: {
      service: { authenticate: vi.fn().mockResolvedValue({ id: userId }) } as never,
      limiter: { consume },
      csrfSecret: "s".repeat(64),
      secureCookies: false,
    },
  });
  return { app, ingest, opportunities, consume };
}
async function csrf(app: ReturnType<typeof createApp>) {
  const response = await request(app).get("/v1/auth/csrf");
  const token = response.body.data.csrfToken as string;
  return { token, cookie: `savoir_access=test; savoir_csrf=${token}` };
}

describe("Q&A HTTP endpoints", () => {
  it("documents the mounted endpoints in OpenAPI", async () => {
    const { app } = setup();
    const response = await request(app).get("/v1/openapi.json");
    expect(response.body.paths["/v1/projects/{projectId}/qa/ingest"].post.operationId).toBe(
      "ingestCustomerQuestions",
    );
    expect(response.body.paths["/v1/projects/{projectId}/qa/opportunities"].get.operationId).toBe(
      "listQuestionOpportunities",
    );
  });
  it("requires authentication and CSRF before ingesting", async () => {
    const { app, ingest, opportunities } = setup();
    expect((await request(app).get(path + "/opportunities")).status).toBe(401);
    expect(
      (
        await request(app)
          .post(path + "/ingest")
          .set("Cookie", "savoir_access=test")
          .send({ questions: [] })
      ).status,
    ).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
    expect(opportunities).not.toHaveBeenCalled();
  });

  it("accepts JSON and raw CSV with authenticated context", async () => {
    const { app, ingest } = setup();
    const { token, cookie } = await csrf(app);
    const body = { questions: [{ source: "faq", questionText: "What is AEO?" }] };
    const response = await request(app)
      .post(path + "/ingest")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", token)
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body.data.imported).toBe(1);
    expect(ingest).toHaveBeenCalledWith(userId, projectId, body);
    const csv = "source,question_text\nfaq,What is AEO?";
    expect(
      (
        await request(app)
          .post(path + "/ingest")
          .set("Cookie", cookie)
          .set("X-CSRF-Token", token)
          .type("text/csv")
          .send(csv)
      ).status,
    ).toBe(200);
    expect(ingest).toHaveBeenLastCalledWith(userId, projectId, csv);
  });

  it("returns opportunities with filters and disables caching", async () => {
    const { app, opportunities } = setup();
    const response = await request(app)
      .get(path + "/opportunities?intent=decision&limit=10")
      .set("Cookie", "savoir_access=test");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(opportunities).toHaveBeenCalledWith(userId, projectId, {
      intent: "decision",
      limit: "10",
    });
  });

  it("rejects invalid payloads, oversized CSV and unsupported content types", async () => {
    const { app } = setup();
    const { token, cookie } = await csrf(app);
    const post = () =>
      request(app)
        .post(path + "/ingest")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", token);
    expect(
      (await post().send({ questions: [{ source: "unknown", questionText: "Why?" }] })).status,
    ).toBe(400);
    expect((await post().type("text/plain").send("Why?")).status).toBe(415);
    expect(
      (
        await post()
          .type("text/csv")
          .send("x".repeat(1024 * 1024 + 1))
      ).status,
    ).toBe(413);
    expect((await post().type("application/json").send('{"invalid":')).status).toBe(400);
  });

  it("propagates missing-project errors and rejects invalid IDs", async () => {
    const { app, opportunities } = setup();
    opportunities.mockRejectedValue(new ApiError(404, "Project not found", "NOT_FOUND"));
    expect(
      (
        await request(app)
          .get(path + "/opportunities")
          .set("Cookie", "savoir_access=test")
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/v1/projects/invalid/qa/opportunities")
          .set("Cookie", "savoir_access=test")
      ).status,
    ).toBe(400);
  });

  it("rate limits reads and fails closed when the limiter is unavailable", async () => {
    const { app, consume, opportunities } = setup();
    consume.mockResolvedValueOnce({ allowed: false, retryAfter: 10 });
    const response = await request(app)
      .get(path + "/opportunities")
      .set("Cookie", "savoir_access=test");
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("10");
    consume.mockRejectedValueOnce(new Error("Redis down"));
    expect(
      (
        await request(app)
          .get(path + "/opportunities")
          .set("Cookie", "savoir_access=test")
      ).status,
    ).toBe(503);
    expect(opportunities).not.toHaveBeenCalled();
  });
});
