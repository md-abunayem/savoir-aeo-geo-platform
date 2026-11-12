import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/config/logger.js";
import { ApiError } from "../src/utils/ApiError.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const user = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Owner",
  email: "owner@example.com",
};
function setup(authorized = true) {
  const billing = {
    authorizeOwner: vi.fn(async () => {
      if (!authorized) throw new ApiError(404, "Resource not found", "NOT_FOUND");
    }),
    getBillingOverview: vi.fn(async () => ({ balance: 100 })),
    createCheckoutSession: vi.fn(async () => ({ url: "https://checkout.stripe.com/test" })),
    handleWebhook: vi.fn(async () => ({ received: true })),
    forOwner: vi.fn(async (_tenant, _user, operation) => operation(billing, {})),
  };
  const app = createApp({
    origins: ["https://app.example.com"],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    billing: billing as never,
    ledger: {} as never,
    auth: {
      service: { authenticate: vi.fn(async () => user) } as never,
      limiter: {} as never,
      csrfSecret: "s".repeat(64),
      secureCookies: false,
    },
  });
  return { app, billing };
}

describe("Billing HTTP authorization", () => {
  it("rejects anonymous reads and checks owner membership before reading", async () => {
    const { app, billing } = setup(false);
    expect((await request(app).get(`/v1/billing/tenants/${tenantId}/overview`)).status).toBe(401);
    expect(
      (
        await request(app)
          .get(`/v1/billing/tenants/${tenantId}/overview`)
          .set("Cookie", "savoir_access=token")
      ).status,
    ).toBe(404);
    expect(billing.getBillingOverview).not.toHaveBeenCalled();
  });
  it("reads under the authenticated owner and disables caching", async () => {
    const { app, billing } = setup();
    const response = await request(app)
      .get(`/v1/billing/tenants/${tenantId}/overview`)
      .set("Cookie", "savoir_access=token");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(billing.forOwner).toHaveBeenCalledWith(tenantId, user.id, expect.any(Function));
  });
  it("requires CSRF and rejects checkout redirects to untrusted origins", async () => {
    const { app, billing } = setup();
    const path = `/v1/billing/tenants/${tenantId}/checkout`;
    expect(
      (await request(app).post(path).set("Cookie", "savoir_access=token").send({})).status,
    ).toBe(403);
    const csrf = await request(app).get("/v1/auth/csrf");
    const cookies = (csrf.headers["set-cookie"] as unknown as string[]).map((v) => v.split(";")[0]);
    const response = await request(app)
      .post(path)
      .set("Cookie", [...cookies, "savoir_access=token"])
      .set("X-CSRF-Token", csrf.body.data.csrfToken)
      .send({ planTier: "growth", returnUrl: "https://attacker.example/" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_RETURN_URL");
    expect(billing.createCheckoutSession).not.toHaveBeenCalled();
  });
  it("passes exact original bytes to webhook signature verification", async () => {
    const { app, billing } = setup();
    const payload = '{ "type": "test", "data": {} }';
    const response = await request(app)
      .post("/v1/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "signed")
      .send(payload);
    expect(response.status).toBe(200);
    expect(billing.handleWebhook).toHaveBeenCalledWith(Buffer.from(payload), "signed");
  });
});
