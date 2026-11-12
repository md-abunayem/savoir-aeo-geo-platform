import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { ActionCenterService } from "../services/action-center/action-center.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  actionDetailParamsSchema,
  listActionsQuerySchema,
  createActionBodySchema,
  updateActionBodySchema,
  bulkUpdateActionsBodySchema,
  addCommentBodySchema,
} from "../validations/action-center.validation.js";

export function actionCenterRoutes(auth: AuthRouteOptions, service: ActionCenterService) {
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
      res.locals.actionContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        userName: res.locals.user.name || "Team Member",
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "actions:" +
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

  // 1. Harvest findings across M5-M16
  router.post(
    "/harvest",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;

      const result = await service.harvestActions(projectId, tenantId);
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            `Harvested ${result.harvestedCount} findings (${result.createdCount} new, ${result.deduplicatedCount} deduplicated).`,
            result,
          ),
        );
    }),
  );

  // 2. Export RFC 4180 CSV
  router.get(
    "/export/csv",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;
      const query = listActionsQuerySchema.parse(req.query);

      const csv = await service.exportCsv(projectId, tenantId, query);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="savoir-actions-${projectId}.csv"`,
      );
      return res.status(200).send(csv);
    }),
  );

  // 3. Bulk update action items
  router.patch(
    "/bulk",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;
      const body = bulkUpdateActionsBodySchema.parse(req.body);

      const result = await service.bulkUpdateActions(projectId, tenantId, body);
      return res
        .status(200)
        .json(new ApiResponse(200, `Bulk updated ${result.updatedCount} action items.`, result));
    }),
  );

  // 4. List actions with filters and stats
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;
      const query = listActionsQuerySchema.parse(req.query);

      const result = await service.listActions(projectId, tenantId, query);
      return res
        .status(200)
        .json(new ApiResponse(200, "Action items retrieved successfully.", result));
    }),
  );

  // 5. Create action item manually
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;
      const body = createActionBodySchema.parse(req.body);

      const action = await service.createAction(projectId, tenantId, body);
      return res
        .status(201)
        .json(new ApiResponse(201, "Action item created successfully.", action));
    }),
  );

  // 6. Get single action item
  router.get(
    "/:actionId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;
      const { actionId } = actionDetailParamsSchema.parse({ ...req.params, projectId, tenantId });

      const action = await service.getAction(actionId, projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Action item retrieved successfully.", action));
    }),
  );

  // 7. Update action item
  router.patch(
    "/:actionId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;
      const { actionId } = actionDetailParamsSchema.parse({ ...req.params, projectId, tenantId });
      const body = updateActionBodySchema.parse(req.body);

      const action = await service.updateAction(actionId, projectId, tenantId, body);
      return res
        .status(200)
        .json(new ApiResponse(200, "Action item updated successfully.", action));
    }),
  );

  // 8. Trigger closed-loop verification
  router.post(
    "/:actionId/verify",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;
      const { actionId } = actionDetailParamsSchema.parse({ ...req.params, projectId, tenantId });

      const result = await service.verifyAction(actionId, projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, `Verification complete: ${result.status}.`, result));
    }),
  );

  // 9. List comments for an action
  router.get(
    "/:actionId/comments",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.actionContext;
      const { projectId } = res.locals;
      const { actionId } = actionDetailParamsSchema.parse({ ...req.params, projectId, tenantId });

      const comments = await service.listComments(actionId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Action comments retrieved successfully.", comments));
    }),
  );

  // 10. Add comment to an action
  router.post(
    "/:actionId/comments",
    asyncHandler(async (req, res) => {
      const { tenantId, userId, userName } = res.locals.actionContext;
      const { projectId } = res.locals;
      const { actionId } = actionDetailParamsSchema.parse({ ...req.params, projectId, tenantId });
      const body = addCommentBodySchema.parse(req.body);

      const comment = await service.addComment(
        actionId,
        projectId,
        tenantId,
        userId,
        userName,
        body.body,
      );
      return res.status(201).json(new ApiResponse(201, "Comment added successfully.", comment));
    }),
  );

  return router;
}
