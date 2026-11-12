import { Router } from "express";
import { z } from "zod";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { MonitoringService } from "../services/monitoring/monitoring.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams, monitoringEngine } from "../validations/monitoring.validation.js";
export function monitoringRoutes(auth: AuthRouteOptions, service: MonitoringService) {
  const router = Router({ mergeParams: true });
  router.use(authenticate(auth.service));
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const csrf = createCsrf(auth.csrfSecret, auth.secureCookies);
  router.use((req, res, next) => (req.method === "GET" ? next() : csrf.verify(req, res, next)));
  router.use(
    asyncHandler(async (req, res, next) => {
      const p = projectParams.parse(req.params);
      res.locals.monitoringContext = { tenantId: p.tenantId, userId: res.locals.user.id };
      res.locals.projectId = p.projectId;
      let limit;
      try {
        limit = await auth.limiter.consume(
          "monitoring:" +
            res.locals.user.id +
            ":" +
            p.projectId +
            (req.method === "GET" ? ":read" : ":write"),
          req.method === "GET" ? 120 : 10,
          60,
        );
      } catch {
        throw new ApiError(503, "Rate limiter unavailable", "MONITORING_UNAVAILABLE");
      }
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfter));
        throw new ApiError(429, "Too many monitoring requests", "RATE_LIMITED");
      }
      next();
    }),
  );
  router.get(
    "/engines",
    asyncHandler(async (_req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Monitoring engines",
          await service.engines(res.locals.monitoringContext, res.locals.projectId),
        ),
      );
    }),
  );
  for (const kind of ["prompts", "schedules", "runs", "events"] as const)
    router.get(
      "/" + kind,
      asyncHandler(async (req, res) => {
        res.json(
          new ApiResponse(
            200,
            "Monitoring " + kind,
            await service.list(res.locals.monitoringContext, res.locals.projectId, kind, req.query),
          ),
        );
      }),
    );
  router.get(
    "/prompts/summary",
    asyncHandler(async (_req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Prompt summary",
          await service.promptSummary(res.locals.monitoringContext, res.locals.projectId),
        ),
      );
    }),
  );
  router.get(
    "/prompts/suggestions",
    asyncHandler(async (_req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Local prompt suggestions",
          await service.promptSuggestions(res.locals.monitoringContext, res.locals.projectId),
        ),
      );
    }),
  );
  router.post(
    "/prompts/import",
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            "Prompts imported",
            await service.importPrompts(
              res.locals.monitoringContext,
              res.locals.projectId,
              req.body,
              req.get("Idempotency-Key") ?? "",
            ),
          ),
        );
    }),
  );
  router.post(
    "/prompts/bulk",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Prompts updated",
          await service.bulkPrompts(res.locals.monitoringContext, res.locals.projectId, req.body),
        ),
      );
    }),
  );
  router.get(
    "/prompts/:id/versions",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Prompt version history",
          await service.promptVersions(
            res.locals.monitoringContext,
            res.locals.projectId,
            z.uuid().parse(req.params.id),
          ),
        ),
      );
    }),
  );
  router.get(
    "/prompts/:id/answers",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Prompt answers and sources",
          await service.promptAnswers(
            res.locals.monitoringContext,
            res.locals.projectId,
            z.uuid().parse(req.params.id),
          ),
        ),
      );
    }),
  );
  router.post(
    "/prompts",
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            "Prompt created",
            await service.createPrompt(
              res.locals.monitoringContext,
              res.locals.projectId,
              req.body,
              req.get("Idempotency-Key"),
            ),
          ),
        );
    }),
  );
  router.patch(
    "/prompts/:id",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Prompt updated",
          await service.updatePrompt(
            res.locals.monitoringContext,
            res.locals.projectId,
            z.uuid().parse(req.params.id),
            req.body,
          ),
        ),
      );
    }),
  );
  router.post(
    "/prompts/:id/schedules/status",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Prompt schedule selection updated",
          await service.promptScheduleStatus(
            res.locals.monitoringContext,
            res.locals.projectId,
            z.uuid().parse(req.params.id),
            req.body,
          ),
        ),
      );
    }),
  );
  router.post(
    "/runs/stop-quota-retries",
    asyncHandler(async (_req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Quota retries stopped",
          await service.stopQuotaRetries(res.locals.monitoringContext, res.locals.projectId),
        ),
      );
    }),
  );
  router.post(
    "/schedules",
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            "Schedule created",
            await service.createSchedule(
              res.locals.monitoringContext,
              res.locals.projectId,
              req.body,
              req.get("Idempotency-Key"),
            ),
          ),
        );
    }),
  );
  router.patch(
    "/schedules/:id",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Schedule updated",
          await service.scheduleStatus(
            res.locals.monitoringContext,
            res.locals.projectId,
            z.uuid().parse(req.params.id),
            req.body,
          ),
        ),
      );
    }),
  );
  router.delete(
    "/schedules/:id",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Schedule deleted",
          await service.scheduleStatus(
            res.locals.monitoringContext,
            res.locals.projectId,
            z.uuid().parse(req.params.id),
            { status: "deleted" },
          ),
        ),
      );
    }),
  );
  router.post(
    "/schedules/status",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Project Gemini schedules updated",
          await service.allScheduleStatus(
            res.locals.monitoringContext,
            res.locals.projectId,
            req.body,
          ),
        ),
      );
    }),
  );
  router.post(
    "/runs",
    asyncHandler(async (req, res) => {
      res
        .status(202)
        .json(
          new ApiResponse(
            202,
            "Monitoring runs queued",
            await service.run(
              res.locals.monitoringContext,
              res.locals.projectId,
              req.get("Idempotency-Key") ?? "",
              req.body,
            ),
          ),
        );
    }),
  );
  router.get(
    "/runs/:id",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Monitoring run",
          await service.detail(
            res.locals.monitoringContext,
            res.locals.projectId,
            z.uuid().parse(req.params.id),
          ),
        ),
      );
    }),
  );
  router.get(
    "/runs/:id/evidence",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Monitoring evidence",
          await service.evidence(
            res.locals.monitoringContext,
            res.locals.projectId,
            z.uuid().parse(req.params.id),
          ),
        ),
      );
    }),
  );
  router.get(
    "/health",
    asyncHandler(async (_req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Monitoring health",
          await service.health(res.locals.monitoringContext, res.locals.projectId),
        ),
      );
    }),
  );
  router.post(
    "/canary",
    asyncHandler(async (req, res) => {
      const body = z.object({ engine: monitoringEngine }).parse(req.body);
      const result = await service.canary(
        res.locals.monitoringContext,
        res.locals.projectId,
        body.engine,
        req.get("Idempotency-Key") ?? "",
      );
      res.json(new ApiResponse(200, "Connection test result", result));
    }),
  );
  return router;
}
