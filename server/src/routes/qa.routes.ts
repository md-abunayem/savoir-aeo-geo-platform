import { Router, text } from "express";
import { z } from "zod";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { QaService } from "../services/intelligence/qa.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

export function qaRoutes(auth: AuthRouteOptions, service: QaService) {
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
      res.locals.qaProjectId = z.uuid().parse(req.params.projectId);
      let limit;
      try {
        limit = await auth.limiter.consume(
          `qa:${res.locals.user.id}:${req.method === "GET" ? "read" : "ingest"}`,
          req.method === "GET" ? 120 : 10,
          60,
        );
      } catch {
        throw new ApiError(503, "Q&A temporarily unavailable", "QA_UNAVAILABLE");
      }
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfter));
        throw new ApiError(429, "Too many requests", "RATE_LIMITED");
      }
      next();
    }),
  );
  router.post(
    "/ingest",
    text({ type: ["text/csv", "application/csv"], limit: "1mb" }),
    asyncHandler(async (req, res) => {
      if (!req.is(["application/json", "text/csv", "application/csv"])) {
        throw new ApiError(415, "Use application/json or text/csv", "UNSUPPORTED_MEDIA_TYPE");
      }
      const result = await service.ingest(res.locals.user.id, res.locals.qaProjectId, req.body);
      res.status(200).json(new ApiResponse(200, "Questions ingested", result));
    }),
  );
  router.get(
    "/opportunities",
    asyncHandler(async (req, res) => {
      const result = await service.opportunities(
        res.locals.user.id,
        res.locals.qaProjectId,
        req.query,
      );
      res.json(new ApiResponse(200, "Question opportunities retrieved", result));
    }),
  );
  return router;
}
