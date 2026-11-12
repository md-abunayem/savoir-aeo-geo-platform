import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import {
  createPasswordResetService,
  type PasswordResetService,
} from "../../src/services/password-reset.service.js";
import { createAuthService, type AuthService } from "../../src/services/auth.service.js";
import { createPayloadCipher } from "../../src/services/email/crypto.js";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/config/logger.js";
import { ApiError } from "../../src/utils/ApiError.js";
import type { RateLimiter } from "../../src/services/rate-limit.service.js";
let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let reset: PasswordResetService;
let auth: AuthService;
let passwordHash: string;
const password = "Original-test-password-83!";
const nextPassword = "Replacement-test-password-94!";
const key = "cd".repeat(32);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const allowed: RateLimiter = { consume: async () => ({ allowed: true, retryAfter: 1 }) };
function app(limiter = allowed) {
  return createApp({
    origins: [],
    logger: createLogger("silent"),
    readiness: async () => ({
      ready: true,
      checks: { database: "up", redis: "up", storage: "up" },
    }),
    auth: {
      service: auth,
      passwordReset: reset,
      limiter,
      csrfSecret: "c".repeat(64),
      secureCookies: false,
    },
  });
}
async function user(verified = true) {
  const id = randomUUID(),
    email = id + "@test.invalid";
  await f.database.query(
    "INSERT INTO users(id,name,email,password_hash,email_verified_at) VALUES($1,'Test',$2,$3,$4)",
    [id, email, passwordHash, verified ? new Date() : null],
  );
  return { id, email };
}
async function token(id: string) {
  const rows = await f.database.query(
    "SELECT encrypted_payload FROM email_outbox WHERE user_id=$1 ORDER BY created_at DESC",
    [id],
  );
  const encrypted = rows.rows[0].encrypted_payload as string;
  const message = createPayloadCipher(key).decrypt(encrypted) as { text: string };
  const code = /[a-f0-9]{64}/.exec(message.text)![0];
  expect(encrypted).not.toContain(code);
  return code;
}
beforeAll(async () => {
  f = await createDatabaseFixture();
  passwordHash = await bcrypt.hash(password, 12);
  reset = await createPasswordResetService(f.runtime, key, async () => {});
  auth = await createAuthService(f.runtime, "s".repeat(64));
});
afterAll(async () => {
  await f?.close();
});
it("resets through HTTP, revokes every session and queues a change notification", async () => {
  const u = await user();
  const sessions = await Promise.all([
    auth.login(u.email, password),
    auth.login(u.email, password),
  ]);
  const agent = request.agent(app());
  const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
  const requested = await agent
    .post("/v1/auth/forgot-password")
    .set("X-CSRF-Token", csrf)
    .send({ email: u.email.toUpperCase() });
  expect(requested.status).toBe(202);
  expect(requested.body.data).toBeNull();
  expect(requested.headers["cache-control"]).toBe("no-store");
  expect((await auth.authenticate(sessions[0]!.tokens.accessToken)).id).toBe(u.id);
  const code = await token(u.id);
  expect(
    (
      await f.database.query("SELECT token_hash FROM password_reset_tokens WHERE user_id=$1", [
        u.id,
      ])
    ).rows[0].token_hash,
  ).toBe(hash(code));
  const result = await agent
    .post("/v1/auth/reset-password")
    .set("X-CSRF-Token", csrf)
    .send({ token: code, password: nextPassword });
  expect(result.status).toBe(200);
  expect(String(result.headers["set-cookie"])).toContain("savoir_access=;");
  expect(JSON.stringify(result.body)).not.toContain(code);
  for (const session of sessions) {
    await expect(auth.authenticate(session.tokens.accessToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
    await expect(auth.refresh(session.tokens.refreshToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
  }
  await expect(auth.login(u.email, password)).rejects.toMatchObject({
    code: "INVALID_CREDENTIALS",
  });
  expect((await auth.login(u.email, nextPassword)).user.id).toBe(u.id);
  await expect(reset.reset(code, nextPassword)).rejects.toMatchObject({
    code: "INVALID_RESET_TOKEN",
  });
  const messages = await f.database.query(
    "SELECT encrypted_payload FROM email_outbox WHERE user_id=$1",
    [u.id],
  );
  const decoded = messages.rows.map(
    (row) => createPayloadCipher(key).decrypt(row.encrypted_payload) as { subject: string },
  );
  expect(decoded.map((m) => m.subject)).toContain("Your Savoir password was changed");
  const events = await f.database.query("SELECT event FROM auth_events WHERE user_id=$1", [u.id]);
  expect(events.rows.map((r) => r.event)).toEqual(
    expect.arrayContaining(["password.reset_requested", "password.reset_completed"]),
  );
});
it("uses generic responses for unknown, disabled and passwordless accounts", async () => {
  const disabled = await user(),
    passwordless = await user();
  await f.database.query("UPDATE users SET disabled_at=now() WHERE id=$1", [disabled.id]);
  await f.database.query("UPDATE users SET password_hash=NULL WHERE id=$1", [passwordless.id]);
  const agent = request.agent(app());
  const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
  const responses = [];
  for (const email of [randomUUID() + "@test.invalid", disabled.email, passwordless.email]) {
    const response = await agent
      .post("/v1/auth/forgot-password")
      .set("X-CSRF-Token", csrf)
      .send({ email });
    expect(response.status).toBe(202);
    responses.push(response.body);
  }
  expect(responses[0]).toEqual(responses[1]);
  expect(responses[1]).toEqual(responses[2]);
  expect(
    (
      await f.database.query("SELECT id FROM email_outbox WHERE user_id=ANY($1::uuid[])", [
        [disabled.id, passwordless.id],
      ])
    ).rowCount,
  ).toBe(0);
});
it("recovers an unverified password account and invalidates its verification code", async () => {
  const u = await user(false);
  await f.runtime.query("SELECT savoir_verification_issue($1,$2,$3)", [
    u.email,
    hash("old-verification"),
    new Date(Date.now() + 600000),
  ]);
  await reset.request(u.email);
  await reset.reset(await token(u.id), nextPassword);
  expect((await auth.login(u.email, nextPassword)).user.id).toBe(u.id);
  expect(
    (await f.database.query("SELECT * FROM email_verification_tokens WHERE user_id=$1", [u.id]))
      .rowCount,
  ).toBe(0);
});
it("enforces resend cooldown, replacement, expiry, token purpose and disabled-account checks", async () => {
  const u = await user();
  await reset.request(u.email);
  const first = await token(u.id);
  await reset.request(u.email);
  expect(await token(u.id)).toBe(first);
  await f.database.query(
    "UPDATE password_reset_tokens SET created_at=now()-interval '61 seconds' WHERE user_id=$1",
    [u.id],
  );
  await reset.request(u.email);
  const second = await token(u.id);
  expect(second).not.toBe(first);
  await expect(reset.reset(first, nextPassword)).rejects.toMatchObject({
    code: "INVALID_RESET_TOKEN",
  });
  await f.database.query("UPDATE users SET disabled_at=now() WHERE id=$1", [u.id]);
  await expect(reset.reset(second, nextPassword)).rejects.toMatchObject({
    code: "INVALID_RESET_TOKEN",
  });
  await f.database.query("UPDATE users SET disabled_at=NULL WHERE id=$1", [u.id]);
  await f.database.query(
    "UPDATE password_reset_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [u.id],
  );
  await expect(reset.reset(second, nextPassword)).rejects.toMatchObject({
    code: "INVALID_RESET_TOKEN",
  });
  const pending = await user(false);
  const verification = randomBytes(32).toString("hex");
  await f.runtime.query("SELECT savoir_verification_issue($1,$2,$3)", [
    pending.email,
    hash(verification),
    new Date(Date.now() + 600000),
  ]);
  await expect(reset.reset(verification, nextPassword)).rejects.toMatchObject({
    code: "INVALID_RESET_TOKEN",
  });
});
it("rolls back both reset issuance and password changes when email enqueue fails", async () => {
  const u = await user();
  await reset.request(u.email);
  const code = await token(u.id);
  const session = await auth.login(u.email, password);
  const fresh = await user();
  await f.database.query(
    "CREATE FUNCTION public.reject_reset_test_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$",
  );
  await f.database.query(
    "CREATE TRIGGER reject_reset_test_email BEFORE INSERT ON email_outbox FOR EACH ROW EXECUTE FUNCTION public.reject_reset_test_email()",
  );
  try {
    await expect(reset.request(fresh.email)).rejects.toThrow();
    expect(
      (await f.database.query("SELECT * FROM password_reset_tokens WHERE user_id=$1", [fresh.id]))
        .rowCount,
    ).toBe(0);
    await expect(reset.reset(code, nextPassword)).rejects.toThrow();
    expect((await auth.authenticate(session.tokens.accessToken)).id).toBe(u.id);
    expect((await auth.login(u.email, password)).user.id).toBe(u.id);
    expect(
      (
        await f.database.query(
          "SELECT * FROM auth_events WHERE user_id=$1 AND event='password.reset_completed'",
          [u.id],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await f.database.query("DROP TRIGGER reject_reset_test_email ON email_outbox");
    await f.database.query("DROP FUNCTION public.reject_reset_test_email()");
  }
  await reset.reset(code, nextPassword);
});
it("rejects weak and breached passwords without consuming the reset token", async () => {
  const u = await user();
  await reset.request(u.email);
  const code = await token(u.id);
  for (const bad of ["short", "\u754c".repeat(25)])
    await expect(reset.reset(code, bad)).rejects.toThrow();
  for (const errorCode of ["PASSWORD_COMPROMISED", "PASSWORD_CHECK_UNAVAILABLE"]) {
    const failing = await createPasswordResetService(f.runtime, key, async () => {
      throw new ApiError(503, "unavailable", errorCode);
    });
    await expect(failing.reset(code, nextPassword)).rejects.toMatchObject({ code: errorCode });
  }
  await reset.reset(code, nextPassword);
});
it("accepts only one concurrent reset and rejects sessions based on the old password hash", async () => {
  const u = await user();
  await reset.request(u.email);
  const code = await token(u.id);
  const results = await Promise.allSettled([
    reset.reset(code, nextPassword),
    reset.reset(code, nextPassword),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const stale = await f.runtime.query("SELECT * FROM savoir_auth_create_session($1,$2,$3,$4)", [
    u.id,
    hash(randomUUID()),
    randomUUID(),
    passwordHash,
  ]);
  expect(stale.rowCount).toBe(0);
  await expect(
    f.runtime.query("SELECT * FROM savoir_auth_create_session($1,$2,$3)", [
      u.id,
      hash(randomUUID()),
      randomUUID(),
    ]),
  ).rejects.toThrow();
});
it("does not let a refresh racing reset survive the reset", async () => {
  const u = await user();
  const session = await auth.login(u.email, password);
  await reset.request(u.email);
  const code = await token(u.id);
  const results = await Promise.allSettled([
    auth.refresh(session.tokens.refreshToken),
    reset.reset(code, nextPassword),
  ]);
  expect(results[1].status).toBe("fulfilled");
  if (results[0].status === "fulfilled")
    await expect(auth.authenticate(results[0].value!.accessToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
  expect(
    (
      await f.database.query(
        "SELECT id FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL",
        [u.id],
      )
    ).rowCount,
  ).toBe(0);
});
it("protects HTTP requests with CSRF, rate limits, validation and no-store", async () => {
  for (const path of ["forgot-password", "reset-password"])
    expect(
      (
        await request(app())
          .post("/v1/auth/" + path)
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
    for (const path of ["forgot-password", "reset-password"]) {
      const result = await agent
        .post("/v1/auth/" + path)
        .set("X-CSRF-Token", csrf)
        .send({});
      expect(result.status).toBe(status);
      if (status === 429) expect(result.headers["retry-after"]).toBe("60");
    }
  }
  const agent = request.agent(app());
  const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
  expect(
    (
      await agent
        .post("/v1/auth/reset-password")
        .set("X-CSRF-Token", csrf)
        .send({ token: "bad", password: nextPassword })
    ).status,
  ).toBe(400);
  const spec = await agent.get("/v1/openapi.json");
  expect(spec.body.paths["/v1/auth/reset-password"]).toBeDefined();
  await expect(f.runtime.query("SELECT * FROM password_reset_tokens")).rejects.toThrow();
  await expect(f.runtime.query("DELETE FROM password_reset_tokens")).rejects.toThrow();
  await expect(createPasswordResetService(f.database, key, async () => {})).rejects.toThrow(
    "restricted runtime database role",
  );
});
