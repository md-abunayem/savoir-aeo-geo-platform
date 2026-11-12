import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { ProjectManagementService } from "../services/project-management.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
export function projectManagementRoutes(auth: AuthRouteOptions, service: ProjectManagementService) {
  const router = Router();
  router.use(authenticate(auth.service));
  const csrf = createCsrf(auth.csrfSecret, auth.secureCookies);
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") next();
    else csrf.verify(req, res, next);
  });
  router.use(
    asyncHandler(async (req, res, next) => {
      const limit = await auth.limiter.consume(
        `project-management:${res.locals.user.id}:${req.method === "GET" ? "read" : "write"}`,
        req.method === "GET" ? 120 : 30,
        60,
      );
      if (!limit.allowed) throw new ApiError(429, "Too many project requests", "RATE_LIMITED");
      next();
    }),
  );
  router.get(
    "/summaries",
    asyncHandler(async (_req, res) => {
      res.json(
        new ApiResponse(200, "Latest project results", await service.summaries(res.locals.user.id)),
      );
    }),
  );
  router.get("/connections", (_req, res) => {
    res.json(new ApiResponse(200, "Provider configuration", service.connections()));
  });
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            "Project saved",
            await service.create(res.locals.user.id, req.get("Idempotency-Key"), req.body),
          ),
        );
    }),
  );
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Project details",
          await service.detail(res.locals.user.id, String(req.params.id)),
        ),
      );
    }),
  );
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Project updated",
          await service.update(res.locals.user.id, String(req.params.id), req.body),
        ),
      );
    }),
  );
  router.patch(
    "/:id/status",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Project status updated",
          await service.status(res.locals.user.id, String(req.params.id), req.body.status),
        ),
      );
    }),
  );
  router.post(
    "/:id/launch",
    asyncHandler(async (req, res) => {
      res
        .status(202)
        .json(
          new ApiResponse(
            202,
            "Launch accepted",
            await service.launch(
              res.locals.user.id,
              String(req.params.id),
              req.get("Idempotency-Key"),
              req.body,
            ),
          ),
        );
    }),
  );
  return router;
}
