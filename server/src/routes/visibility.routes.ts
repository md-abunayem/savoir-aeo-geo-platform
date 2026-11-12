import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { VisibilityService } from "../services/analytics/visibility.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  visibilityQuerySchema,
  savedViewInputSchema,
  metricGoalInputSchema,
} from "../validations/visibility.validation.js";

export function visibilityRoutes(auth: AuthRouteOptions, service: VisibilityService) {
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
      res.locals.visibilityContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "visibility:" +
            res.locals.user.id +
            ":" +
            p.projectId +
            (req.method === "GET" ? ":read" : ":write"),
          req.method === "GET" ? 120 : 30,
          60,
        );
      } catch {
        throw new ApiError(429, "Too many requests", "RATE_LIMITED");
      }
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfter));
        throw new ApiError(429, "Too many requests", "RATE_LIMITED");
      }
      next();
    }),
  );

  // 1. Overview KPIs & Composite Visibility Score (VIS-FR-001 to VIS-FR-007)
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const query = visibilityQuerySchema.parse(req.query);

      if (query.format === "csv") {
        const csv = await service.exportCsv(
          res.locals.visibilityContext,
          res.locals.projectId,
          query,
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="visibility-export.csv"');
        res.status(200).send(csv);
        return;
      }

      const overview = await service.getVisibilityOverview(
        res.locals.visibilityContext,
        res.locals.projectId,
        query,
      );
      res.json(new ApiResponse(200, "Visibility overview retrieved", overview));
    }),
  );

  // 2. Trend & 7-Day Rolling Average with Event Annotations (VIS-FR-010)
  router.get(
    "/trend",
    asyncHandler(async (req, res) => {
      const query = visibilityQuerySchema.parse(req.query);
      const trend = await service.getTrend(
        res.locals.visibilityContext,
        res.locals.projectId,
        query,
      );
      res.json(new ApiResponse(200, "Visibility trend retrieved", trend));
    }),
  );

  // 3. Statistically Significant Trend Anomalies with FDR Control (VIS-FR-008)
  router.get(
    "/anomalies",
    asyncHandler(async (req, res) => {
      const query = visibilityQuerySchema.parse(req.query);
      const anomalies = await service.getAnomalies(
        res.locals.visibilityContext,
        res.locals.projectId,
        query,
      );
      res.json(new ApiResponse(200, "Visibility anomalies evaluated", anomalies));
    }),
  );

  // 4. CSV Export endpoint (VIS-FR-009)
  router.get(
    "/export",
    asyncHandler(async (req, res) => {
      const query = visibilityQuerySchema.parse(req.query);
      const csv = await service.exportCsv(
        res.locals.visibilityContext,
        res.locals.projectId,
        query,
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="visibility-metrics.csv"');
      res.status(200).send(csv);
    }),
  );

  // 5. Saved Views CRUD (VIS-FR-011)
  router.get(
    "/saved-views",
    asyncHandler(async (_req, res) => {
      const views = await service.listSavedViews(
        res.locals.visibilityContext,
        res.locals.projectId,
      );
      res.json(new ApiResponse(200, "Saved views retrieved", views));
    }),
  );

  router.post(
    "/saved-views",
    asyncHandler(async (req, res) => {
      const body = savedViewInputSchema.parse(req.body);
      const view = await service.createSavedView(
        res.locals.visibilityContext,
        res.locals.projectId,
        body,
      );
      res.status(201).json(new ApiResponse(201, "Saved view created", view));
    }),
  );

  router.delete(
    "/saved-views/:viewId",
    asyncHandler(async (req, res) => {
      const result = await service.deleteSavedView(
        res.locals.visibilityContext,
        res.locals.projectId,
        String(req.params.viewId),
      );
      res.json(new ApiResponse(200, "Saved view deleted", result));
    }),
  );

  // 6. Metric Goals CRUD (VIS-FR-011)
  router.get(
    "/goals",
    asyncHandler(async (_req, res) => {
      const goals = await service.listMetricGoals(
        res.locals.visibilityContext,
        res.locals.projectId,
      );
      res.json(new ApiResponse(200, "Metric goals retrieved", goals));
    }),
  );

  router.post(
    "/goals",
    asyncHandler(async (req, res) => {
      const body = metricGoalInputSchema.parse(req.body);
      const goal = await service.createMetricGoal(
        res.locals.visibilityContext,
        res.locals.projectId,
        body,
      );
      res.status(201).json(new ApiResponse(201, "Metric goal created", goal));
    }),
  );

  router.delete(
    "/goals/:goalId",
    asyncHandler(async (req, res) => {
      const result = await service.deleteMetricGoal(
        res.locals.visibilityContext,
        res.locals.projectId,
        String(req.params.goalId),
      );
      res.json(new ApiResponse(200, "Metric goal deleted", result));
    }),
  );

  return router;
}
