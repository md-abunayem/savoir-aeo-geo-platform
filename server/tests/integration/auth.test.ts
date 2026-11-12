import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { createAuthService, type AuthService } from "../../src/services/auth.service.js";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/config/logger.js";
import type { RateLimiter } from "../../src/services/rate-limit.service.js";

let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let auth: AuthService;
const userId = randomUUID();
const password = "Savoir-test-password-only-123!";
const csrfSecret = "c".repeat(64);
const allowed: RateLimiter = { consume: async () => ({ allowed: true, retryAfter: 1 }) };
const readiness = async () =>
  ({ ready: true, checks: { database: "up", redis: "up", storage: "up" } }) as const;
function app(limiter = allowed, secureCookies = false) {
  return createApp({
    origins: ["http://localhost:3000"],
    logger: createLogger("silent"),
    readiness,
    auth: { service: auth, limiter, csrfSecret, secureCookies },
  });
}
beforeAll(async () => {
  fixture = await createDatabaseFixture();
  auth = await createAuthService(fixture.runtime, "s".repeat(64));
  const hash = await bcrypt.hash(password, 12);
  await fixture.database.query(
    "INSERT INTO users(id,name,email,password_hash,email_verified_at) VALUES($1,'Owner','owner@test.invalid',$2,now()),($3,'Pending','pending@test.invalid',$2,NULL)",
    [userId, hash, randomUUID()],
  );
});
afterAll(async () => {
  await fixture?.close();
});

describe("real identity sessions behind the HTTP boundary", () => {
  it("rejects direct runtime access to global session records", async () => {
    await expect(fixture.runtime.query("SELECT * FROM auth_sessions")).rejects.toThrow();
  });
  it("requires signed double-submit CSRF even for login", async () => {
    const missing = await request(app())
      .post("/v1/auth/login")
      .send({ email: "owner@test.invalid", password });
    expect(missing.status).toBe(403);
    const forged = await request(app())
      .post("/v1/auth/login")
      .set("Cookie", "savoir_csrf=forged")
      .set("X-CSRF-Token", "forged")
      .send({ email: "owner@test.invalid", password });
    expect(forged.status).toBe(403);
  });
  it("logs in verified users and never returns password hashes or tokens in JSON", async () => {
    const agent = request.agent(app());
    const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
    const response = await agent
      .post("/v1/auth/login")
      .set("X-CSRF-Token", csrf)
      .send({ email: "OWNER@test.invalid", password });
    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual({
      id: userId,
      name: "Owner",
      email: "owner@test.invalid",
    });
    expect(JSON.stringify(response.body)).not.toContain("Token");
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(response.headers["set-cookie"])).toContain("SameSite=Strict");
    expect((await agent.get("/v1/auth/me")).status).toBe(200);
  });
  it("returns the same error for wrong credentials, unknown users and unverified accounts", async () => {
    const agent = request.agent(app());
    const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
    for (const input of [
      { email: "owner@test.invalid", password: "wrong" },
      { email: "missing@test.invalid", password },
      { email: "pending@test.invalid", password },
    ]) {
      const result = await agent.post("/v1/auth/login").set("X-CSRF-Token", csrf).send(input);
      expect(result.status).toBe(401);
      expect(result.body.code).toBe("INVALID_CREDENTIALS");
    }
  });
  it("rotates refresh tokens and revokes the entire family on replay", async () => {
    const original = await auth.login("owner@test.invalid", password);
    const rotated = await auth.refresh(original.tokens.refreshToken);
    expect(rotated.refreshToken).not.toBe(original.tokens.refreshToken);
    await expect(auth.authenticate(original.tokens.accessToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
    expect((await auth.authenticate(rotated.accessToken)).id).toBe(userId);
    await expect(auth.refresh(original.tokens.refreshToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
    await expect(auth.authenticate(rotated.accessToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
    const events = await fixture.database.query(
      "SELECT event FROM auth_events WHERE user_id=$1 AND event='session.replay_revoked'",
      [userId],
    );
    expect(events.rowCount).toBeGreaterThan(0);
  });
  it("serializes concurrent refreshes and detects the losing replay", async () => {
    const original = await auth.login("owner@test.invalid", password);
    const results = await Promise.allSettled([
      auth.refresh(original.tokens.refreshToken),
      auth.refresh(original.tokens.refreshToken),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const winner = results.find((r) => r.status === "fulfilled");
    if (winner?.status === "fulfilled")
      await expect(auth.authenticate(winner.value.accessToken)).rejects.toMatchObject({
        code: "INVALID_SESSION",
      });
  });
  it("revokes sessions on logout and immediately denies disabled users", async () => {
    const first = await auth.login("owner@test.invalid", password);
    await auth.logout(first.tokens.refreshToken);
    await expect(auth.authenticate(first.tokens.accessToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
    const second = await auth.login("owner@test.invalid", password);
    await fixture.database.query("UPDATE users SET disabled_at=now() WHERE id=$1", [userId]);
    await expect(auth.authenticate(second.tokens.accessToken)).rejects.toMatchObject({
      code: "INVALID_SESSION",
    });
    await fixture.database.query("UPDATE users SET disabled_at=NULL WHERE id=$1", [userId]);
    await expect(auth.authenticate("malformed")).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });
  it("stores only refresh-token hashes", async () => {
    const login = await auth.login("owner@test.invalid", password);
    const rows = await fixture.database.query(
      "SELECT token_hash FROM auth_sessions WHERE user_id=$1",
      [userId],
    );
    expect(rows.rows.every((row) => /^[a-f0-9]{64}$/.test(row.token_hash))).toBe(true);
    expect(rows.rows.some((row) => row.token_hash === login.tokens.refreshToken)).toBe(false);
  });
  it("fails closed when rate limiting is unavailable and exposes Retry-After on limits", async () => {
    for (const [limiter, status] of [
      [{ consume: async () => ({ allowed: false, retryAfter: 60 }) }, 429],
      [
        {
          consume: async () => {
            throw new Error("Redis unavailable");
          },
        },
        503,
      ],
    ] as const) {
      const agent = request.agent(app(limiter));
      const csrf = (await agent.get("/v1/auth/csrf")).body.data.csrfToken;
      const result = await agent
        .post("/v1/auth/login")
        .set("X-CSRF-Token", csrf)
        .send({ email: "owner@test.invalid", password });
      expect(result.status).toBe(status);
      if (status === 429) expect(result.headers["retry-after"]).toBe("60");
    }
  });
});

it("rejects a privileged database connection at authentication startup", async () => {
  await expect(createAuthService(fixture.database, "s".repeat(64))).rejects.toThrow(
    "restricted runtime database role",
  );
});
