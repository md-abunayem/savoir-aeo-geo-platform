import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { createOAuthService } from "../src/services/oauth.service.js";

describe("OAuth Service Unit Tests", () => {
  const mockRedisStore = new Map<string, string>();
  const mockRedis = {
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      mockRedisStore.set(key, value);
    }),
    get: vi.fn(async (key: string) => mockRedisStore.get(key) || null),
    del: vi.fn(async (key: string) => {
      mockRedisStore.delete(key);
    }),
  } as unknown as Redis;

  const mockQuery = vi.fn();
  const mockPool = {
    query: mockQuery,
  } as unknown as Pool;

  const jwtSecret = "s".repeat(64);
  const oauthService = createOAuthService(mockPool, mockRedis, jwtSecret, {
    allowMock: true,
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/auth/callback/google",
  });

  it("does not accept mock callback codes without explicit test configuration", async () => {
    const liveService = createOAuthService(mockPool, mockRedis, jwtSecret, {});
    const { state } = await liveService.generateGoogleAuthUrl();
    await expect(liveService.handleGoogleCallback("mock_testuser", state)).rejects.toMatchObject({
      code: "OAUTH_DISABLED",
    });
  });

  it("generates Google OAuth URL with PKCE state and S256 challenge", async () => {
    const result = await oauthService.generateGoogleAuthUrl("/onboarding");

    expect(result.url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(result.url).toContain("client_id=test-client-id");
    expect(result.url).toContain("code_challenge_method=S256");
    expect(result.url).toContain("state=" + result.state);
    expect(result.state).toHaveLength(64);

    expect(mockRedis.setex).toHaveBeenCalledWith(
      `oauth:google:${result.state}`,
      600,
      expect.stringContaining("codeVerifier"),
    );
  });

  it("handles Google callback with mock code and links identity", async () => {
    // 1. Generate auth URL to populate state in mockRedis
    const { state } = await oauthService.generateGoogleAuthUrl("/onboarding");

    // 2. Mock DB responses
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ user_id: "11111111-1111-1111-1111-111111111111", is_new: true }],
      }) // savoir_oauth_login_or_link
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            name: "Google User",
            email: "user@test.invalid",
          },
        ],
      }) // user lookup
      .mockResolvedValueOnce({
        rows: [
          {
            session_id: "22222222-2222-2222-2222-222222222222",
            user_id: "11111111-1111-1111-1111-111111111111",
            expires_at: new Date(Date.now() + 7 * 86400000),
          },
        ],
      }); // savoir_oauth_create_session

    const callbackResult = await oauthService.handleGoogleCallback("mock_testuser", state);

    expect(callbackResult.user.email).toBe("user@test.invalid");
    expect(callbackResult.tokens.accessToken).toBeDefined();
    expect(callbackResult.tokens.refreshToken).toBeDefined();
    expect(callbackResult.returnTo).toBe("/onboarding");
  });

  it("rejects invalid or expired OAuth state", async () => {
    await expect(
      oauthService.handleGoogleCallback("any_code", "0".repeat(64)),
    ).rejects.toThrowError(/expired or is invalid/);
  });
});
