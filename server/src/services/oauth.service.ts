import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { ApiError } from "../utils/ApiError.js";
import { ACCESS_SECONDS, type AuthTokens, type AuthUser } from "./auth.service.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface GoogleOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  allowMock?: boolean;
}

export interface OAuthService {
  generateGoogleAuthUrl(returnTo?: string): Promise<{ url: string; state: string }>;
  handleGoogleCallback(
    code: string,
    state: string,
  ): Promise<{ user: AuthUser; tokens: AuthTokens; returnTo?: string }>;
}

export function createOAuthService(
  pool: Pool,
  redis: Redis,
  jwtSecret: string,
  config: GoogleOAuthConfig,
): OAuthService {
  const jwtKey = new TextEncoder().encode(jwtSecret);

  async function issueTokens(
    session: { session_id: string; user_id: string; expires_at: Date },
    refreshToken: string,
  ): Promise<AuthTokens> {
    const accessToken = await new SignJWT({ sid: session.session_id })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("savoir")
      .setAudience("savoir-web")
      .setSubject(session.user_id)
      .setIssuedAt()
      .setExpirationTime(ACCESS_SECONDS + "s")
      .sign(jwtKey);

    return { accessToken, refreshToken, expiresAt: session.expires_at };
  }

  return {
    async generateGoogleAuthUrl(returnTo) {
      const state = randomBytes(32).toString("hex");
      const codeVerifier = randomBytes(48).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

      // Save PKCE verifier in Redis for 10 minutes (600s)
      await redis.setex(
        `oauth:google:${state}`,
        600,
        JSON.stringify({ codeVerifier, returnTo: returnTo || "/dashboard" }),
      );

      const clientId = config.clientId || "mock-google-client-id";
      const redirectUri = config.redirectUri || "http://localhost:3000/auth/callback/google";

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
      });

      return {
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        state,
      };
    },

    async handleGoogleCallback(code, state) {
      if (!state || !/^[a-f0-9]{64}$/.test(state)) {
        throw new ApiError(400, "Invalid or missing OAuth state", "INVALID_OAUTH_STATE");
      }

      const stateKey = `oauth:google:${state}`;
      const stateDataRaw = await redis.get(stateKey);
      if (!stateDataRaw) {
        throw new ApiError(400, "OAuth state has expired or is invalid", "INVALID_OAUTH_STATE");
      }
      // Single use: delete state immediately to prevent replay attacks
      await redis.del(stateKey);

      let parsedState: { codeVerifier: string; returnTo?: string };
      try {
        parsedState = JSON.parse(stateDataRaw);
      } catch {
        throw new ApiError(400, "Corrupted OAuth state session", "INVALID_OAUTH_STATE");
      }

      let profile: { sub: string; email: string; name?: string };

      // Check if real Google credentials are configured and not running in mock mode
      const isMock = config.allowMock === true;
      if (!isMock && (!config.clientId || !config.clientSecret)) {
        throw new ApiError(503, "Google OAuth is not configured", "OAUTH_DISABLED");
      }

      if (isMock) {
        // Deterministic mock flow for tests and offline development
        const suffix = code.replace(/^mock_/, "");
        profile = {
          sub: `google-sub-${suffix}`,
          email: `${suffix || "user"}@test.invalid`.toLowerCase(),
          name: `Google User ${suffix || "Test"}`,
        };
      } else {
        // Live Google token exchange
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.clientId || "",
            client_secret: config.clientSecret || "",
            code,
            code_verifier: parsedState.codeVerifier,
            grant_type: "authorization_code",
            redirect_uri: config.redirectUri || "http://localhost:3000/auth/callback/google",
          }).toString(),
        });

        if (!tokenRes.ok) {
          throw new ApiError(
            401,
            "Google authorization code exchange failed",
            "OAUTH_EXCHANGE_FAILED",
          );
        }

        const tokenData = (await tokenRes.json()) as { access_token?: string; id_token?: string };
        if (!tokenData.access_token) {
          throw new ApiError(401, "No access token received from Google", "OAUTH_EXCHANGE_FAILED");
        }

        const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        if (!userinfoRes.ok) {
          throw new ApiError(
            401,
            "Failed to retrieve user profile from Google",
            "OAUTH_PROFILE_FAILED",
          );
        }

        const userInfo = (await userinfoRes.json()) as {
          sub?: string;
          email?: string;
          name?: string;
          email_verified?: boolean;
        };

        if (!userInfo.sub || !userInfo.email) {
          throw new ApiError(
            400,
            "Google user profile lacks required identifier or email",
            "INVALID_OAUTH_USER",
          );
        }

        profile = {
          sub: userInfo.sub,
          email: userInfo.email.toLowerCase(),
          name: userInfo.name,
        };
      }

      // Link identity or register user atomically
      const userResult = await pool.query<{ user_id: string; is_new: boolean }>(
        "SELECT * FROM public.savoir_oauth_login_or_link($1, $2, $3, $4)",
        ["google", profile.sub, profile.email, profile.name || profile.email.split("@")[0]],
      );

      const userId = userResult.rows[0]?.user_id;
      if (!userId) {
        throw new ApiError(
          500,
          "Failed to link or create user from OAuth identity",
          "OAUTH_ACCOUNT_ERROR",
        );
      }

      // Fetch user record
      const userLookup = await pool.query<AuthUser>(
        "SELECT id, name, email FROM public.users WHERE id = $1 AND disabled_at IS NULL",
        [userId],
      );
      const user = userLookup.rows[0];
      if (!user) {
        throw new ApiError(401, "User account is unavailable or disabled", "ACCOUNT_DISABLED");
      }

      // Issue session and tokens
      const refreshToken = randomBytes(48).toString("base64url");
      const sessionResult = await pool.query<{
        session_id: string;
        user_id: string;
        expires_at: Date;
      }>("SELECT * FROM public.savoir_oauth_create_session($1, $2, $3)", [
        userId,
        hashToken(refreshToken),
        randomUUID(),
      ]);

      const session = sessionResult.rows[0];
      if (!session) {
        throw new ApiError(
          401,
          "Unable to establish authenticated session",
          "SESSION_CREATION_FAILED",
        );
      }

      const tokens = await issueTokens(session, refreshToken);

      return {
        user,
        tokens,
        returnTo: parsedState.returnTo,
      };
    },
  };
}
