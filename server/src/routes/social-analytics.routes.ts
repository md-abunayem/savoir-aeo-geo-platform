import { Router } from "express";
import { z } from "zod";
import type { AuthRouteOptions } from "./auth.routes.js";
import { SocialAnalyticsService } from "../services/publishing/social-analytics.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

export function socialAnalyticsRoutes(auth: AuthRouteOptions, service: SocialAnalyticsService) {
  const router = Router({ mergeParams: true });
  const csrf = createCsrf(auth.csrfSecret, auth.secureCookies);

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.use(authenticate(auth.service));
  router.use((req, res, next) => (req.method === "GET" ? next() : csrf.verify(req, res, next)));

  router.use(
    asyncHandler(async (req, res, next) => {
      res.locals.perfProjectId = z.string().uuid().parse(req.params.projectId);
      let limit;
      try {
        limit = await auth.limiter.consume(
          `perf:${res.locals.user.id}:${req.method === "GET" ? "read" : "write"}`,
          req.method === "GET" ? 120 : 30,
          60,
        );
      } catch {
        throw new ApiError(
          503,
          "Performance analytics temporarily unavailable",
          "PERF_UNAVAILABLE",
        );
      }
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfter));
        throw new ApiError(429, "Too many requests", "RATE_LIMITED");
      }
      next();
    }),
  );

  /**
   * Ingest post performance statistics directly
   */
  router.post(
    "/ingest",
    asyncHandler(async (req, res) => {
      const result = await service.ingest(res.locals.user.id, res.locals.perfProjectId, req.body);
      res.status(200).json(new ApiResponse(200, "Performance record ingested", result));
    }),
  );

  /**
   * Poll Buffer API for post performance metrics by delivery ID
   */
  router.post(
    "/sync-buffer/:deliveryId",
    asyncHandler(async (req, res) => {
      const deliveryId = z.string().uuid().parse(req.params.deliveryId);
      const result = await service.pollBufferAnalytics(
        res.locals.user.id,
        res.locals.perfProjectId,
        deliveryId,
      );
      res.status(200).json(new ApiResponse(200, "Buffer metrics synced", result));
    }),
  );

  /**
   * Query top 5% performing assets
   */
  router.get(
    "/top",
    asyncHandler(async (req, res) => {
      const cluster = typeof req.query.cluster === "string" ? req.query.cluster : undefined;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 5;
      const result = await service.getTopPerformingAssets(
        res.locals.user.id,
        res.locals.perfProjectId,
        { topicCluster: cluster, limit },
      );
      res.status(200).json(new ApiResponse(200, "Top performing assets retrieved", result));
    }),
  );

  /**
   * Strategy Feedback Loop:
   * Query winning patterns extracted from top 5% performing assets for a topic cluster
   */
  router.get(
    "/patterns",
    asyncHandler(async (req, res) => {
      const cluster = typeof req.query.cluster === "string" ? req.query.cluster : "";
      const result = await service.getWinningPatternsForCluster(
        res.locals.user.id,
        res.locals.perfProjectId,
        cluster,
      );
      res.status(200).json(new ApiResponse(200, "Winning patterns retrieved", result));
    }),
  );

  /**
   * Cluster performance summary
   */
  router.get(
    "/summary",
    asyncHandler(async (req, res) => {
      const result = await service.getClusterSummary(res.locals.user.id, res.locals.perfProjectId);
      res.status(200).json(new ApiResponse(200, "Cluster performance summary retrieved", result));
    }),
  );

  return router;
}
