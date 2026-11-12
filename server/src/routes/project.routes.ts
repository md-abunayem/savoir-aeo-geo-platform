import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { ProjectService } from "../services/project.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
export function projectRoutes(auth: AuthRouteOptions, service: ProjectService) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(authenticate(auth.service));
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      let limit;
      try {
        limit = await auth.limiter.consume("projects:" + res.locals.user.id, 60, 60);
      } catch {
        throw new ApiError(503, "Project listing temporarily unavailable", "PROJECTS_UNAVAILABLE");
      }
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfter));
        throw new ApiError(429, "Too many requests", "RATE_LIMITED");
      }
      res.json(
        new ApiResponse(200, "Your projects", await service.list(res.locals.user.id, req.query)),
      );
    }),
  );
  return router;
}
