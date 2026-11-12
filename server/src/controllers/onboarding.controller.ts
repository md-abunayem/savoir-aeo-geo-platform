import type { Queue } from "bullmq";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import type { OnboardingService } from "../services/onboarding.service.js";
import type { RateLimiter } from "../services/rate-limit.service.js";

export function onboardingController(
  service: OnboardingService,
  limiter: RateLimiter,
  monitoringQueue?: Queue,
) {
  async function limit(userId: string, key: string, count: number, seconds: number) {
    let result: Awaited<ReturnType<RateLimiter["consume"]>>;
    try {
      result = await limiter.consume(`onb:${key}:${userId}`, count, seconds);
    } catch {
      throw new ApiError(
        503,
        "Onboarding service temporarily unavailable",
        "ONBOARDING_UNAVAILABLE",
      );
    }
    if (!result.allowed) {
      throw new ApiError(429, "Too many onboarding requests", "RATE_LIMITED");
    }
  }

  return {
    getDraft: asyncHandler(async (_req, res) => {
      const draft = await service.getDraft(res.locals.user.id);
      res.json(new ApiResponse(200, "Onboarding draft", draft));
    }),

    saveDraft: asyncHandler(async (req, res) => {
      await limit(res.locals.user.id, "save", 60, 60);
      await service.saveDraft(res.locals.user.id, req.body);
      res.json(new ApiResponse(200, "Draft saved", null));
    }),

    deleteDraft: asyncHandler(async (_req, res) => {
      await service.deleteDraft(res.locals.user.id);
      res.json(new ApiResponse(200, "Draft removed", null));
    }),

    analyzeDomain: asyncHandler(async (req, res) => {
      await limit(res.locals.user.id, "analyze", 20, 60);
      const data = await service.analyzeDomain(res.locals.user.id, req.body);
      res.json(new ApiResponse(200, "Domain analyzed", data));
    }),

    generateSeeds: asyncHandler(async (req, res) => {
      await limit(res.locals.user.id, "seeds", 20, 60);
      const data = await service.generateSeeds(req.body);
      res.json(new ApiResponse(200, "Seed recommendations generated", data));
    }),

    estimateCosts: asyncHandler(async (req, res) => {
      const data = service.estimateCosts(req.body);
      res.json(new ApiResponse(200, "Cost estimation calculated", data));
    }),

    activate: asyncHandler(async (req, res) => {
      await limit(res.locals.user.id, "activate", 10, 60);
      const data = await service.activate(res.locals.user.id, req.body, monitoringQueue);
      res.json(new ApiResponse(201, "Project activated and monitoring enqueued", data));
    }),
  };
}
