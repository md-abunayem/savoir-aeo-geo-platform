import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { ExecutiveDashboardService } from "../services/reporting/executive-dashboard.service.js";
import type { AlertEngineService } from "../services/reporting/alert-engine.service.js";
import type { ReportGeneratorService } from "../services/reporting/report-generator.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  createScheduleSchema,
  generateReportSchema,
  createAlertRuleSchema,
  updateIncidentSchema,
  dashboardQuerySchema,
  incidentsQuerySchema,
} from "../validations/reporting.validation.js";

export function reportingRoutes(
  auth: AuthRouteOptions,
  dashboardService: ExecutiveDashboardService,
  alertService: AlertEngineService,
  reportService: ReportGeneratorService,
) {
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
      res.locals.reportingContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "reporting:" +
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

  // 1. Executive Dashboard (RPT-FR-001, RPT-FR-002, RPT-FR-011)
  router.get(
    "/dashboard",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;
      const query = dashboardQuerySchema.parse(req.query);

      const dashboard = await dashboardService.getDashboard(projectId, tenantId, query.days);
      return res
        .status(200)
        .json(new ApiResponse(200, "Executive dashboard retrieved successfully.", dashboard));
    }),
  );

  // 2. List Report Schedules (RPT-FR-003)
  router.get(
    "/schedules",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;

      const schedules = await reportService.listSchedules(projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Report schedules retrieved successfully.", schedules));
    }),
  );

  // 3. Create Report Schedule (RPT-FR-003, RPT-FR-005)
  router.post(
    "/schedules",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;
      const body = createScheduleSchema.parse(req.body);

      const schedule = await reportService.createSchedule(projectId, tenantId, body);
      return res
        .status(201)
        .json(new ApiResponse(201, "Report schedule created successfully.", schedule));
    }),
  );

  // 4. Delete Report Schedule
  router.delete(
    "/schedules/:scheduleId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;
      const scheduleId = String(req.params.scheduleId);

      const result = await reportService.deleteSchedule(scheduleId, projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Report schedule deleted successfully.", result));
    }),
  );

  // 5. List Generated Reports
  router.get(
    "/reports",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;

      const reports = await reportService.listReports(projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Generated reports retrieved successfully.", reports));
    }),
  );

  // 6. Generate On-Demand Report (RPT-FR-004, RPT-FR-005, RPT-FR-010)
  router.post(
    "/reports/generate",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;
      const body = generateReportSchema.parse(req.body);

      const result = await reportService.generateReport(projectId, tenantId, body);
      return res
        .status(201)
        .json(new ApiResponse(201, "Executive report generated successfully.", result));
    }),
  );

  // 7. List Alert Rules (RPT-FR-006)
  router.get(
    "/alerts/rules",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;

      const rules = await alertService.listRules(projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Alert rules retrieved successfully.", rules));
    }),
  );

  // 8. Create Alert Rule (RPT-FR-006, RPT-FR-007)
  router.post(
    "/alerts/rules",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;
      const body = createAlertRuleSchema.parse(req.body);

      const rule = await alertService.createRule(projectId, tenantId, body);
      return res
        .status(201)
        .json(new ApiResponse(201, "Alert rule configured successfully.", rule));
    }),
  );

  // 9. Delete Alert Rule
  router.delete(
    "/alerts/rules/:ruleId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;
      const ruleId = String(req.params.ruleId);

      const result = await alertService.deleteRule(ruleId, projectId, tenantId);
      return res.status(200).json(new ApiResponse(200, "Alert rule deleted successfully.", result));
    }),
  );

  // 10. List Alert Incidents (RPT-FR-008, RPT-FR-009)
  router.get(
    "/alerts/incidents",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.reportingContext;
      const { projectId } = res.locals;
      const query = incidentsQuerySchema.parse(req.query);

      const incidents = await alertService.listIncidents(projectId, tenantId, query);
      return res
        .status(200)
        .json(new ApiResponse(200, "Alert incidents retrieved successfully.", incidents));
    }),
  );

  // 11. Update Alert Incident Status (RPT-FR-009)
  router.patch(
    "/alerts/incidents/:incidentId",
    asyncHandler(async (req, res) => {
      const { tenantId, userId } = res.locals.reportingContext;
      const { projectId } = res.locals;
      const incidentId = String(req.params.incidentId);
      const body = updateIncidentSchema.parse(req.body);

      const incident = await alertService.updateIncident(incidentId, projectId, tenantId, {
        status: body.status,
        notes: body.notes,
        userId,
      });
      return res
        .status(200)
        .json(new ApiResponse(200, "Alert incident status updated successfully.", incident));
    }),
  );

  return router;
}
