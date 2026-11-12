import { Router } from "express";
import { z } from "zod";
import type { ApiKeyService } from "../services/integrations/api-key.service.js";
import type { TrafficAnalyticsService } from "../services/integrations/traffic-analytics.service.js";
import type { ActionCenterService } from "../services/action-center/action-center.service.js";
import { runWithTenantContext } from "../db/tenant-query.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { trafficOverviewQuerySchema } from "../validations/integrations.validation.js";
import { listActionsQuerySchema } from "../validations/action-center.validation.js";

export function publicApiRoutes(
  keys: ApiKeyService,
  traffic: TrafficAnalyticsService,
  actions: ActionCenterService,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get(
    "/projects/:projectId/traffic",
    asyncHandler(async (req, res) => {
      const projectId = z.uuid().parse(req.params.projectId);
      const query = trafficOverviewQuerySchema.parse(req.query);
      const context = await keys.authorize(
        req.get("Authorization"),
        projectId,
        "read:traffic",
        req.ip ?? "unknown",
      );
      const data = await runWithTenantContext(context, () =>
        traffic.getOverview(projectId, context.tenantId, query.days),
      );
      res.json(new ApiResponse(200, "Traffic overview retrieved", data));
    }),
  );
  router.get(
    "/projects/:projectId/actions",
    asyncHandler(async (req, res) => {
      const projectId = z.uuid().parse(req.params.projectId);
      const query = listActionsQuerySchema.parse(req.query);
      const context = await keys.authorize(
        req.get("Authorization"),
        projectId,
        "read:actions",
        req.ip ?? "unknown",
      );
      const data = await runWithTenantContext(context, () =>
        actions.listActions(projectId, context.tenantId, query),
      );
      res.json(new ApiResponse(200, "Actions retrieved", data));
    }),
  );
  return router;
}
