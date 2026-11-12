import type { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { loginSchema } from "../validations/auth.validation.js";
import { ACCESS_SECONDS, type AuthService, type AuthTokens } from "../services/auth.service.js";
import type { OAuthService } from "../services/oauth.service.js";
import type { RateLimiter } from "../services/rate-limit.service.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../middlewares/auth.middleware.js";

export function authController(
  auth: AuthService,
  limiter: RateLimiter,
  secure: boolean,
  oauth?: OAuthService,
) {
  const options = { httpOnly: true, secure, sameSite: "strict" as const };
  function setTokens(res: Response, tokens: AuthTokens) {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...options,
      path: "/",
      maxAge: ACCESS_SECONDS * 1000,
    });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...options,
      path: "/v1/auth",
      expires: tokens.expiresAt,
    });
  }
  async function limit(res: Response, key: string, count: number, seconds: number) {
    let result: Awaited<ReturnType<RateLimiter["consume"]>>;
    try {
      result = await limiter.consume(key, count, seconds);
    } catch {
      throw new ApiError(503, "Authentication temporarily unavailable", "AUTH_UNAVAILABLE");
    }
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter));
      throw new ApiError(429, "Too many authentication attempts", "RATE_LIMITED");
    }
  }
  return {
    login: asyncHandler(async (req, res) => {
      await limit(res, "auth-ip:" + req.ip, 30, 60);
      const input = loginSchema.parse(req.body);
      await limit(res, "auth-account:" + input.email, 10, 900);
      const result = await auth.login(input.email, input.password);
      setTokens(res, result.tokens);
      res.json(new ApiResponse(200, "Signed in", { user: result.user }));
    }),
    refresh: asyncHandler(async (req, res) => {
      await limit(res, "auth-refresh-ip:" + req.ip, 60, 60);
      const token: unknown = req.cookies?.[REFRESH_COOKIE];
      if (typeof token !== "string")
        throw new ApiError(401, "Session is invalid or expired", "INVALID_SESSION");
      setTokens(res, await auth.refresh(token));
      res.json(new ApiResponse(200, "Session refreshed", null));
    }),
    logout: asyncHandler(async (req, res) => {
      await limit(res, "auth-logout-ip:" + req.ip, 60, 60);
      const token: unknown = req.cookies?.[REFRESH_COOKIE];
      if (typeof token === "string") await auth.logout(token);
      res.clearCookie(ACCESS_COOKIE, { ...options, path: "/" });
      res.clearCookie(REFRESH_COOKIE, { ...options, path: "/v1/auth" });
      res.json(new ApiResponse(200, "Signed out", null));
    }),
    me: asyncHandler(async (_req, res) => {
      res.json(new ApiResponse(200, "Current user", { user: res.locals.user }));
    }),
    googleUrl: asyncHandler(async (req, res) => {
      if (!oauth) {
        throw new ApiError(501, "Google OAuth is not configured", "OAUTH_DISABLED");
      }
      await limit(res, "oauth-url-ip:" + req.ip, 30, 60);
      const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : undefined;
      const data = await oauth.generateGoogleAuthUrl(returnTo);
      res.json(new ApiResponse(200, "Google OAuth URL generated", data));
    }),
    googleCallback: asyncHandler(async (req, res) => {
      if (!oauth) {
        throw new ApiError(501, "Google OAuth is not configured", "OAUTH_DISABLED");
      }
      await limit(res, "oauth-cb-ip:" + req.ip, 30, 60);
      const code =
        typeof req.body?.code === "string" ? req.body.code : String(req.query?.code || "");
      const state =
        typeof req.body?.state === "string" ? req.body.state : String(req.query?.state || "");

      if (!code || !state) {
        throw new ApiError(
          400,
          "Missing authorization code or state parameter",
          "INVALID_OAUTH_PARAMS",
        );
      }

      const result = await oauth.handleGoogleCallback(code, state);
      setTokens(res, result.tokens);
      res.json(
        new ApiResponse(200, "Google sign-in successful", {
          user: result.user,
          returnTo: result.returnTo || "/dashboard",
        }),
      );
    }),
    googleCallbackRedirect: asyncHandler(async (req, res) => {
      if (!oauth) {
        throw new ApiError(501, "Google OAuth is not configured", "OAUTH_DISABLED");
      }
      await limit(res, "oauth-cb-ip:" + req.ip, 30, 60);
      const code = String(req.query?.code || "");
      const state = String(req.query?.state || "");
      if (!code || !state) {
        throw new ApiError(400, "Missing code or state query parameter", "INVALID_OAUTH_PARAMS");
      }
      const result = await oauth.handleGoogleCallback(code, state);
      setTokens(res, result.tokens);
      const destination = result.returnTo || "/dashboard";
      res.redirect(destination);
    }),
  };
}
