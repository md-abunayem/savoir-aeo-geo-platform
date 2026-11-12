import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import {
  createRegistrationService,
  type RegistrationService,
} from "../../src/services/registration.service.js";
import { createAuthService, type AuthService } from "../../src/services/auth.service.js";
import { createPayloadCipher } from "../../src/services/email/crypto.js";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/config/logger.js";
import { ApiError } from "../../src/utils/ApiError.js";
import type { RateLimiter } from "../../src/services/rate-limit.service.js";
let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let registration: RegistrationService;
let auth: AuthService;
const key = "ab".repeat(32);
const password = "Unique-test-password-467!";
const allowed: RateLimiter = { consume: async () => ({ allowed: true, retryAfter: 1 }) };
const address = () => randomUUID() + "@test.invalid";
function app(limiter = allowed) {
  return createApp({
    origins: ["http://localhost:3000"],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    auth: {
      service: auth,
      registration,
      limiter,
      csrfSecret: "c".repeat(64),
      secureCookies: false,
    },
  });
}
async function emailToken(email: string) {
  const result = await fixture.database.query(
    "SELECT e.encrypted_payload FROM email_outbox e JOIN users u ON u.id=e.user_id WHERE u.email=$1 ORDER BY e.created_at DESC",
    [email],
  );
  const payload = result.rows[0]?.encrypted_payload as string;
  const message = createPayloadCipher(key).decrypt(payload) as { text: string };
  const token = /[a-f0-9]{64}/.exec(message.text)![0];
  expect(payload).not.toContain(token);
  return token;
}
beforeAll(async () => {
  fixture = await createDatabaseFixture();
  registration = await createRegistrationService(fixture.runtime, key, async () => {});
  auth = await createAuthService(fixture.runtime, "s".repeat(64));
});
afterAll(async () => {
  await fixture?.close();
});
it("registers via HTTP, requires password confirmation to verify, then permits login", async () => {
  const email = address();
  const agent = request.agent(app());
  const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
  const registered = await agent
    .post("/v1/auth/register")
    .set("X-CSRF-Token", csrf)
    .send({ name: "Test", email, password });
  expect(registered.status).toBe(202);
  expect(registered.body.data).toBeNull();
  expect(registered.headers["cache-control"]).toBe("no-store");
  await expect(auth.login(email, password)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  const token = await emailToken(email);
  const row = (
    await fixture.database.query(
      "SELECT u.password_hash,t.token_hash FROM users u JOIN email_verification_tokens t ON t.user_id=u.id WHERE u.email=$1",
      [email],
    )
  ).rows[0];
  expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  expect(await bcrypt.compare(password, row.password_hash)).toBe(true);
  const wrong = await agent
    .post("/v1/auth/verify-email")
    .set("X-CSRF-Token", csrf)
    .send({ token, password: "wrong" });
  expect(wrong.status).toBe(400);
  const verified = await agent
    .post("/v1/auth/verify-email")
    .set("X-CSRF-Token", csrf)
    .send({ token, password });
  expect(verified.status).toBe(200);
  expect(verified.headers["set-cookie"]).toBeUndefined();
  expect((await auth.login(email, password)).user.email).toBe(email);
  await expect(registration.verify(token, password)).rejects.toMatchObject({
    code: "INVALID_VERIFICATION",
  });
  const events = await fixture.database.query(
    "SELECT event FROM auth_events a JOIN users u ON u.id=a.user_id WHERE u.email=$1",
    [email],
  );
  expect(events.rows.map((r) => r.event)).toEqual(
    expect.arrayContaining([
      "account.registered",
      "email.verification_requested",
      "email.verified",
    ]),
  );
});
it("deduplicates concurrent and case-variant registration without changing credentials", async () => {
  const email = address();
  await Promise.all([
    registration.register({ name: "Test", email, password }),
    registration.register({ name: "Test", email: email.toUpperCase(), password }),
  ]);
  await registration.register({ name: "Replacement", email, password: "Different-password-789!" });
  expect(
    (await fixture.database.query("SELECT name FROM users WHERE email=$1", [email])).rows,
  ).toEqual([{ name: "Test" }]);
  expect(
    (
      await fixture.database.query(
        "SELECT e.id FROM email_outbox e JOIN users u ON u.id=e.user_id WHERE u.email=$1",
        [email],
      )
    ).rowCount,
  ).toBe(1);
  await registration.verify(await emailToken(email), password);
});
it("rolls back identity, token and audit records when enqueue fails", async () => {
  const email = address();
  await fixture.database.query(
    "CREATE FUNCTION public.reject_test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$",
  );
  await fixture.database.query(
    "CREATE TRIGGER reject_test_outbox BEFORE INSERT ON email_outbox FOR EACH ROW EXECUTE FUNCTION public.reject_test_outbox()",
  );
  try {
    await expect(registration.register({ name: "Rollback", email, password })).rejects.toThrow();
    expect(
      (await fixture.database.query("SELECT id FROM users WHERE email=$1", [email])).rowCount,
    ).toBe(0);
  } finally {
    await fixture.database.query("DROP TRIGGER reject_test_outbox ON email_outbox");
    await fixture.database.query("DROP FUNCTION public.reject_test_outbox()");
  }
});
it("resends after cooldown, invalidates the old code and expires codes", async () => {
  const email = address();
  await registration.register({ name: "Test", email, password });
  const first = await emailToken(email);
  await registration.resend(email);
  expect(await emailToken(email)).toBe(first);
  await fixture.database.query(
    "UPDATE email_verification_tokens SET created_at=now()-interval '61 seconds' WHERE user_id=(SELECT id FROM users WHERE email=$1)",
    [email],
  );
  await registration.resend(email);
  const second = await emailToken(email);
  expect(second).not.toBe(first);
  await expect(registration.verify(first, password)).rejects.toMatchObject({
    code: "INVALID_VERIFICATION",
  });
  await fixture.database.query(
    "UPDATE email_verification_tokens SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email=$1)",
    [email],
  );
  await expect(registration.verify(second, password)).rejects.toMatchObject({
    code: "INVALID_VERIFICATION",
  });
});
it("accepts only one concurrent consumption and rejects disabled accounts", async () => {
  const email = address();
  await registration.register({ name: "Test", email, password });
  const token = await emailToken(email);
  await fixture.database.query("UPDATE users SET disabled_at=now() WHERE email=$1", [email]);
  await expect(registration.verify(token, password)).rejects.toMatchObject({
    code: "INVALID_VERIFICATION",
  });
  await fixture.database.query("UPDATE users SET disabled_at=NULL WHERE email=$1", [email]);
  const results = await Promise.allSettled([
    registration.verify(token, password),
    registration.verify(token, password),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("does not reveal account existence or allow direct token-table access", async () => {
  const agent = request.agent(app());
  const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
  const email = address();
  const data = { name: "Test", email, password };
  const first = await agent.post("/v1/auth/register").set("X-CSRF-Token", csrf).send(data);
  const duplicate = await agent.post("/v1/auth/register").set("X-CSRF-Token", csrf).send(data);
  expect(duplicate.body).toEqual(first.body);
  const missing = await agent
    .post("/v1/auth/resend-verification")
    .set("X-CSRF-Token", csrf)
    .send({ email: address() });
  expect(missing.body).toEqual(first.body);
  await expect(fixture.runtime.query("SELECT * FROM email_verification_tokens")).rejects.toThrow();
  await expect(fixture.runtime.query("DELETE FROM email_verification_tokens")).rejects.toThrow();
  await expect(createRegistrationService(fixture.database, key, async () => {})).rejects.toThrow(
    "restricted runtime database role",
  );
});
it("requires CSRF, fails closed on rate-limit outages and documents the routes", async () => {
  for (const route of ["register", "verify-email", "resend-verification"])
    expect(
      (
        await request(app())
          .post("/v1/auth/" + route)
          .send({})
      ).status,
    ).toBe(403);
  for (const [limiter, status] of [
    [{ consume: async () => ({ allowed: false, retryAfter: 60 }) }, 429],
    [
      {
        consume: async () => {
          throw new Error("offline");
        },
      },
      503,
    ],
  ] as const) {
    const agent = request.agent(app(limiter));
    const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
    const result = await agent
      .post("/v1/auth/register")
      .set("X-CSRF-Token", csrf)
      .send({ name: "Test", email: address(), password });
    expect(result.status).toBe(status);
    if (status === 429) expect(result.headers["retry-after"]).toBe("60");
  }
  const contract = await request(app()).get("/v1/openapi.json");
  expect(contract.body.paths["/v1/auth/verify-email"].post.requestBody).toBeDefined();
});
it("does not create an account when the password check rejects or is unavailable", async () => {
  for (const code of ["PASSWORD_COMPROMISED", "PASSWORD_CHECK_UNAVAILABLE"]) {
    const service = await createRegistrationService(fixture.runtime, key, async () => {
      throw new ApiError(503, "unavailable", code);
    });
    const email = address();
    await expect(service.register({ name: "Test", email, password })).rejects.toMatchObject({
      code,
    });
    expect(
      (await fixture.database.query("SELECT id FROM users WHERE email=$1", [email])).rowCount,
    ).toBe(0);
  }
});
