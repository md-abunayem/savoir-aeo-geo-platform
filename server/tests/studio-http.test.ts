import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/config/logger.js";
import { projectId, studioDocument } from "./studio-fixtures.js";
const base = `/v1/projects/${projectId}/studio`;
function setup() {
  const list = vi
    .fn()
    .mockResolvedValue({ drafts: [], connections: [], media: [], deliveries: [] });
  const create = vi.fn().mockResolvedValue({ id: projectId });
  const approve = vi.fn().mockResolvedValue({ status: "approved" });
  const app = createApp({
    studio: { list, create, approve } as never,
    origins: [],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    auth: {
      service: { authenticate: vi.fn().mockResolvedValue({ id: projectId }) } as never,
      limiter: { consume: vi.fn().mockResolvedValue({ allowed: true }) },
      csrfSecret: "s".repeat(64),
      secureCookies: false,
    },
  });
  return { app, list, create, approve };
}
describe("studio API access and approval", () => {
  it("requires authentication and signed CSRF before mutation", async () => {
    const { app, create } = setup();
    expect((await request(app).get(base)).status).toBe(401);
    expect(
      (
        await request(app)
          .post(base + "/drafts")
          .set("Cookie", "savoir_access=test")
          .send({ document: studioDocument() })
      ).status,
    ).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
  it("uses authenticated ownership context and disables caching", async () => {
    const { app, list } = setup();
    const result = await request(app).get(base).set("Cookie", "savoir_access=test");
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(list).toHaveBeenCalledWith(projectId, projectId);
  });
  it("rejects client-supplied approval fields when importing a draft", async () => {
    const { app, create, approve } = setup();
    const csrf = await request(app).get("/v1/auth/csrf");
    const token = csrf.body.data.csrfToken;
    const result = await request(app)
      .post(base + "/drafts")
      .set("Cookie", `savoir_access=test; savoir_csrf=${token}`)
      .set("X-CSRF-Token", token)
      .send({ document: studioDocument(), status: "approved", validation: { passed: true } });
    expect(result.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
    const approved = await request(app)
      .post(`${base}/drafts/${projectId}/approve`)
      .set("Cookie", `savoir_access=test; savoir_csrf=${token}`)
      .set("X-CSRF-Token", token)
      .send({ revision: 2 });
    expect(approved.status).toBe(200);
    expect(approve).toHaveBeenCalledWith(projectId, projectId, projectId, 2);
  });
});
