import type { Response } from "express";
import type { PasswordResetService } from "../services/password-reset.service.js";
import type { RateLimiter } from "../services/rate-limit.service.js";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validations/password-reset.validation.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../middlewares/auth.middleware.js";
export function passwordResetController(
  service: PasswordResetService,
  limiter: RateLimiter,
  secure: boolean,
) {
  async function limit(res: Response, key: string, count: number, seconds: number) {
    let result;
    try {
      result = await limiter.consume(key, count, seconds);
    } catch {
      throw new ApiError(503, "Authentication temporarily unavailable", "AUTH_UNAVAILABLE");
    }
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter));
      throw new ApiError(429, "Too many password reset attempts", "RATE_LIMITED");
    }
  }
  return {
    request: asyncHandler(async (req, res) => {
      await limit(res, "reset-request-ip:" + req.ip, 10, 900);
      const data = forgotPasswordSchema.parse(req.body);
      await limit(res, "reset-email:" + data.email, 3, 3600);
      await service.request(data.email);
      res
        .status(202)
        .json(
          new ApiResponse(
            202,
            "If the account is eligible, a password reset email will be sent",
            null,
          ),
        );
    }),
    reset: asyncHandler(async (req, res) => {
      await limit(res, "reset-submit-ip:" + req.ip, 20, 900);
      const data = resetPasswordSchema.parse(req.body);
      await limit(res, "reset-token:" + data.token, 5, 900);
      await service.reset(data.token, data.password);
      const cookies = { httpOnly: true, secure, sameSite: "strict" as const };
      res.clearCookie(ACCESS_COOKIE, { ...cookies, path: "/" });
      res.clearCookie(REFRESH_COOKIE, { ...cookies, path: "/v1/auth" });
      res.json(new ApiResponse(200, "Password reset. Sign in with your new password", null));
    }),
  };
}
