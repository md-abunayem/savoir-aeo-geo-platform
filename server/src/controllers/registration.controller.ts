import type { Response } from "express";
import type { RegistrationService } from "../services/registration.service.js";
import type { RateLimiter } from "../services/rate-limit.service.js";
import {
  registrationSchema,
  resendVerificationSchema,
  verificationSchema,
} from "../validations/registration.validation.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

export function registrationController(
  service: RegistrationService,
  limiter: RateLimiter,
  options?: { requireEmailVerification?: boolean },
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
      throw new ApiError(429, "Too many authentication attempts", "RATE_LIMITED");
    }
  }
  const accepted = (res: Response) =>
    res
      .status(202)
      .json(
        new ApiResponse(202, "If the account is eligible, a verification email will be sent", null),
      );
  return {
    register: asyncHandler(async (req, res) => {
      await limit(res, "registration-ip:" + req.ip, 10, 900);
      const data = registrationSchema.parse(req.body);
      await limit(res, "verification-email:" + data.email, 3, 3600);
      await service.register(data);
      if (options?.requireEmailVerification === false) {
        res.status(201).json(
          new ApiResponse(201, "Account created successfully. You can now sign in", {
            verified: true,
          }),
        );
      } else {
        accepted(res);
      }
    }),
    resend: asyncHandler(async (req, res) => {
      await limit(res, "verification-resend-ip:" + req.ip, 10, 900);
      const data = resendVerificationSchema.parse(req.body);
      await limit(res, "verification-email:" + data.email, 3, 3600);
      await service.resend(data.email);
      accepted(res);
    }),
    verify: asyncHandler(async (req, res) => {
      await limit(res, "verification-ip:" + req.ip, 20, 900);
      const data = verificationSchema.parse(req.body);
      await limit(res, "verification-token:" + data.token, 5, 900);
      await service.verify(data.token, data.password);
      res.json(new ApiResponse(200, "Email verified. You can now sign in", null));
    }),
  };
}
