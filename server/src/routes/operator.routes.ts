import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { createOperatorMiddleware } from "../middlewares/operator.middleware.js";
import {
  searchTenantsInput,
  updateTenantStatusInput,
  adjustCreditsInput,
  listAuditLogsInput,
} from "../validations/operator.validation.js";
import type { OperatorService } from "../services/admin/operator.service.js";

export function createOperatorRoutes(
  operatorService: OperatorService,
  operatorSecretKey?: string,
): Router {
  const router = Router();

  // All operator routes are protected by operator credentials (ADM-FR-013)
  router.use(createOperatorMiddleware(operatorSecretKey));

  // 1. Search Tenants (ADM-FR-008)
  router.get(
    "/tenants",
    asyncHandler(async (req: Request, res: Response) => {
      const query = searchTenantsInput.parse(req.query);
      const result = await operatorService.searchTenants(query);
      return res.json(new ApiResponse(200, "Tenants list retrieved successfully.", result));
    }),
  );

  // 2. Tenant Detail (ADM-FR-008)
  router.get(
    "/tenants/:tenantId",
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = String(req.params.tenantId);
      const detail = await operatorService.getTenantDetail(tenantId);
      return res.json(new ApiResponse(200, "Tenant details retrieved successfully.", detail));
    }),
  );

  // 3. Update Tenant Status (Pause / Resume / Archive) (ADM-FR-009)
  router.post(
    "/tenants/:tenantId/status",
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = String(req.params.tenantId);
      const body = updateTenantStatusInput.parse(req.body);
      const operatorId = (req as Request & { operatorId?: string }).operatorId || "operator";
      const ipAddress = req.ip || undefined;

      const result = await operatorService.updateTenantStatus({
        operatorId,
        targetTenantId: tenantId,
        status: body.status,
        reason: body.reason,
        ipAddress,
      });

      return res.json(new ApiResponse(200, "Tenant status updated successfully.", result));
    }),
  );

  // 4. Adjust Credits (ADM-FR-010)
  router.post(
    "/tenants/:tenantId/credits",
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = String(req.params.tenantId);
      const body = adjustCreditsInput.parse(req.body);
      const operatorId = (req as Request & { operatorId?: string }).operatorId || "operator";
      const ipAddress = req.ip || undefined;

      const result = await operatorService.adjustCredits({
        operatorId,
        targetTenantId: tenantId,
        category: body.category,
        amount: body.amount,
        reason: body.reason,
        ipAddress,
      });

      return res.json(new ApiResponse(200, "Credits adjusted successfully.", result));
    }),
  );

  // 5. Queue Health Telemetry (ADM-FR-011)
  router.get(
    "/queues",
    asyncHandler(async (_req: Request, res: Response) => {
      const queues = await operatorService.getQueueHealth();
      return res.json(new ApiResponse(200, "Queue health statistics retrieved.", queues));
    }),
  );

  // 6. Operator Audit Logs (ADM-FR-012)
  router.get(
    "/audit-logs",
    asyncHandler(async (req: Request, res: Response) => {
      const query = listAuditLogsInput.parse(req.query);
      const logs = await operatorService.getAuditLogs(query);
      return res.json(new ApiResponse(200, "Operator audit logs retrieved.", logs));
    }),
  );

  return router;
}
