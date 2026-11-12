import request from "supertest";
import { expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/config/logger.js";
import { ApiError } from "../src/utils/ApiError.js";
function setup() {
  const reset = {
    request: vi.fn(async (_email: string) => {}),
    reset: vi.fn(async (_token: string, _password: string) => {}),
  };
  const app = createApp({
    origins: [],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    auth: {
      service: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn(), authenticate: vi.fn() },
      passwordReset: reset,
      limiter: { consume: async () => ({ allowed: true, retryAfter: 1 }) },
      csrfSecret: "c".repeat(64),
      secureCookies: true,
    },
  });
  return { app, reset };
}
async function csrf(app: ReturnType<typeof createApp>) {
  const response = await request(app).get("/v1/auth/csrf");
  return {
    header: response.body.data.csrfToken as string,
    cookie: String(response.headers["set-cookie"]).split(";")[0]!,
  };
}
it("requires CSRF and returns a generic response without revealing codes", async () => {
  const { app, reset } = setup();
  expect(
    (await request(app).post("/v1/auth/forgot-password").send({ email: "person@example.com" }))
      .status,
  ).toBe(403);
  expect(reset.request).not.toHaveBeenCalled();
  const c = await csrf(app);
  const response = await request(app)
    .post("/v1/auth/forgot-password")
    .set("Cookie", c.cookie)
    .set("X-CSRF-Token", c.header)
    .send({ email: " PERSON@EXAMPLE.COM " });
  expect(response.status).toBe(202);
  expect(response.body.data).toBeNull();
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(reset.request).toHaveBeenCalledWith("person@example.com");
});
it("validates passwords before reset and clears secure cookies only after success", async () => {
  const { app, reset } = setup();
  const c = await csrf(app);
  const token = "a".repeat(64);
  const post = (password: string) =>
    request(app)
      .post("/v1/auth/reset-password")
      .set("Cookie", c.cookie)
      .set("X-CSRF-Token", c.header)
      .send({ token, password });
  expect((await post("short")).status).toBe(400);
  expect(reset.reset).not.toHaveBeenCalled();
  reset.reset.mockRejectedValueOnce(new ApiError(400, "Invalid reset", "INVALID_RESET_TOKEN"));
  const rejected = await post("A-long-new-password-42!");
  expect(rejected.status).toBe(400);
  expect(rejected.headers["set-cookie"]).toBeUndefined();
  const success = await post("A-long-new-password-42!");
  expect(success.status).toBe(200);
  expect(String(success.headers["set-cookie"])).toContain("Secure");
  expect(String(success.headers["set-cookie"])).toContain("HttpOnly");
  expect(String(success.headers["set-cookie"])).toContain("savoir_access=;");
  expect(String(success.headers["set-cookie"])).toContain("savoir_refresh=;");
  expect(JSON.stringify(success.body)).not.toContain(token);
});
it("exposes both reset endpoints in OpenAPI when configured", async () => {
  const { app } = setup();
  const response = await request(app).get("/v1/openapi.json");
  expect(response.body.paths["/v1/auth/forgot-password"].post.requestBody).toBeDefined();
  expect(response.body.paths["/v1/auth/reset-password"].post.requestBody).toBeDefined();
});
