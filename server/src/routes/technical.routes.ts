import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { TechnicalAuditService } from "../services/technical/technical-audit.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  triggerAuditSchema,
  listAuditPagesSchema,
  listAuditIssuesSchema,
  exportAuditSchema,
  auditScheduleSchema,
  updateAuditIssueSchema,
} from "../validations/technical.validation.js";

export function technicalRoutes(auth: AuthRouteOptions, service: TechnicalAuditService) {
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
      res.locals.technicalContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "technical:" +
            res.locals.user.id +
            ":" +
            p.projectId +
            (req.method === "GET" ? ":read" : ":write"),
          req.method === "GET" ? 120 : 20,
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

  // 1. Trigger Site-Side Technical Audit (TEC-FR-001)
  router.post(
    "/audits",
    asyncHandler(async (req, res) => {
      const parsed = triggerAuditSchema.parse({ body: req.body });
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;

      const result = await service
        .forOwner(res.locals.technicalContext)
        .triggerAudit(tenantId, projectId, parsed.body);

      res.status(202).json(new ApiResponse(202, "Technical AEO audit initiated", result));
    }),
  );

  // 2. Get Latest Audit Overview (TEC-FR-011, TEC-FR-016)
  router.get(
    "/audits/latest",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;

      const audit = await service
        .forOwner(res.locals.technicalContext)
        .getLatestAudit(tenantId, projectId);

      res.json(
        new ApiResponse(
          200,
          audit ? "Latest technical audit retrieved" : "No technical audits found for this project",
          audit,
        ),
      );
    }),
  );

  // 3. List Audit History (TEC-FR-013)
  router.get(
    "/audits",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;

      const audits = await service
        .forOwner(res.locals.technicalContext)
        .listAudits(tenantId, projectId, limit);

      res.json(new ApiResponse(200, "Technical audits retrieved successfully", audits));
    }),
  );

  router.get(
    "/audits/schedule",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      const schedule = await service
        .forOwner(res.locals.technicalContext)
        .getSchedule(tenantId, projectId);
      res.json(new ApiResponse(200, "Technical audit schedule retrieved", schedule));
    }),
  );

  router.put(
    "/audits/schedule",
    asyncHandler(async (req, res) => {
      const parsed = auditScheduleSchema.parse({ body: req.body });
      const { tenantId, userId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      const schedule = await service
        .forOwner(res.locals.technicalContext)
        .saveSchedule(tenantId, projectId, userId, parsed.body.frequency);
      res.json(new ApiResponse(200, "Technical audit schedule saved", schedule));
    }),
  );

  router.delete(
    "/audits/schedule",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      await service.forOwner(res.locals.technicalContext).deleteSchedule(tenantId, projectId);
      res.json(new ApiResponse(200, "Technical audit schedule removed", { deleted: true }));
    }),
  );

  // 4. Get Specific Audit Overview
  router.get(
    "/audits/:auditId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      const auditId = String(req.params.auditId);

      const audit = await service
        .forOwner(res.locals.technicalContext)
        .getAuditById(tenantId, projectId, auditId);

      res.json(new ApiResponse(200, "Technical audit retrieved successfully", audit));
    }),
  );

  router.patch(
    "/audits/:auditId/issues/:issueId",
    asyncHandler(async (req, res) => {
      const parsed = updateAuditIssueSchema.parse({ body: req.body });
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      const result = await service
        .forOwner(res.locals.technicalContext)
        .updateIssueStatus(
          tenantId,
          projectId,
          String(req.params.auditId),
          String(req.params.issueId),
          parsed.body.status,
        );
      res.json(new ApiResponse(200, "Technical audit issue updated", result));
    }),
  );

  // 5. Get Audit Pages (TEC-FR-012)
  router.get(
    "/audits/:auditId/pages",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      const auditId = String(req.params.auditId);
      const parsed = listAuditPagesSchema.parse({ query: req.query });

      const result = await service
        .forOwner(res.locals.technicalContext)
        .getAuditPages(tenantId, projectId, auditId, parsed.query);

      res.json(new ApiResponse(200, "Audit pages retrieved successfully", result));
    }),
  );

  // 6. Get Audit Issues (TEC-FR-011)
  router.get(
    "/audits/:auditId/issues",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      const auditId = String(req.params.auditId);
      const parsed = listAuditIssuesSchema.parse({ query: req.query });

      const issues = await service
        .forOwner(res.locals.technicalContext)
        .getAuditIssues(tenantId, projectId, auditId, parsed.query);

      res.json(new ApiResponse(200, "Audit issues retrieved successfully", issues));
    }),
  );

  // 7. Export Audit CSV (RFC 4180) (TEC-FR-014)
  router.get(
    "/audits/:auditId/export",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.technicalContext;
      const projectId = res.locals.projectId as string;
      const auditId = String(req.params.auditId);
      const parsed = exportAuditSchema.parse({ query: req.query });

      const csv = await service
        .forOwner(res.locals.technicalContext)
        .exportAuditCsv(tenantId, projectId, auditId, parsed.query.type, parsed.query);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="technical-audit-${parsed.query.type}-${auditId.slice(0, 8)}.csv"`,
      );
      res.status(200).send(csv);
    }),
  );

  return router;
}
