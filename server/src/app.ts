import { projectRoutes } from "./routes/project.routes.js";
import { studioRoutes } from "./routes/studio.routes.js";
import type { ApprovalService } from "./services/publishing/approval.service.js";
import { qaRoutes } from "./routes/qa.routes.js";
import type { QaService } from "./services/intelligence/qa.service.js";
import { socialAnalyticsRoutes } from "./routes/social-analytics.routes.js";
import type { SocialAnalyticsService } from "./services/publishing/social-analytics.service.js";
import { publicApiRoutes } from "./routes/public-api.routes.js";
import type { ApiKeyService } from "./services/integrations/api-key.service.js";
import { projectManagementRoutes } from "./routes/project-management.routes.js";
import type { ProjectManagementService } from "./services/project-management.service.js";
import type { ProjectService } from "./services/project.service.js";
import { monitoringRoutes } from "./routes/monitoring.routes.js";
import type { MonitoringService } from "./services/monitoring/monitoring.service.js";
import { onboardingRoutes } from "./routes/onboarding.routes.js";
import type { OnboardingService } from "./services/onboarding.service.js";
import { answerRoutes } from "./routes/answer.routes.js";
import type { AnswerService } from "./services/answer/answer.service.js";
import { visibilityRoutes } from "./routes/visibility.routes.js";
import type { VisibilityService } from "./services/analytics/visibility.service.js";
import { citationRoutes } from "./routes/citation.routes.js";
import type { CitationService } from "./services/analytics/citation.service.js";
import { competitorRoutes } from "./routes/competitor.routes.js";
import type { CompetitorService } from "./services/analytics/competitor.service.js";
import { graderRoutes } from "./routes/grader.routes.js";
import type { GraderService } from "./services/grader/grader.service.js";
import { technicalRoutes } from "./routes/technical.routes.js";
import type { TechnicalAuditService } from "./services/technical/technical-audit.service.js";
import { axoRoutes } from "./routes/axo.routes.js";
import type { AxoService } from "./services/axo/axo.service.js";
import { contentRoutes } from "./routes/content.routes.js";
import type { ContentService } from "./services/content/content.service.js";
import { actionCenterRoutes } from "./routes/action-center.routes.js";
import type { ActionCenterService } from "./services/action-center/action-center.service.js";
import { integrationsRoutes } from "./routes/integrations.routes.js";
import type { IntegrationsService } from "./services/integrations/integrations.service.js";
import type { TrafficAnalyticsService } from "./services/integrations/traffic-analytics.service.js";
import { reportingRoutes } from "./routes/reporting.routes.js";
import type { ExecutiveDashboardService } from "./services/reporting/executive-dashboard.service.js";
import type { AlertEngineService } from "./services/reporting/alert-engine.service.js";
import type { ReportGeneratorService } from "./services/reporting/report-generator.service.js";
import { createBillingRoutes } from "./routes/billing.routes.js";
import type { BillingService } from "./services/billing/billing.service.js";
import type { CreditLedgerService } from "./services/billing/credit-ledger.service.js";
import { createOperatorRoutes } from "./routes/operator.routes.js";
import type { OperatorService } from "./services/admin/operator.service.js";
import type { Queue } from "bullmq";
import { authRoutes, type AuthRouteOptions } from "./routes/auth.routes.js";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { Logger } from "pino";
import { ApiError } from "./utils/ApiError.js";
import { requestContext } from "./middlewares/request.middleware.js";
import { createErrorHandler } from "./middlewares/error.middleware.js";
import { healthRoutes } from "./routes/health.routes.js";
import type { Readiness } from "./services/infrastructure.service.js";
import { getOpenApiDocument } from "./config/openapi.js";

export interface AppOptions {
  studio?: ApprovalService;
  qa?: QaService;
  socialAnalytics?: SocialAnalyticsService;
  apiKeys?: ApiKeyService;
  projectManagement?: ProjectManagementService;
  auth?: AuthRouteOptions;
  monitoring?: MonitoringService;
  projects?: ProjectService;
  onboarding?: OnboardingService;
  answers?: AnswerService;
  visibility?: VisibilityService;
  citations?: CitationService;
  competitors?: CompetitorService;
  grader?: GraderService;
  technical?: TechnicalAuditService;
  axo?: AxoService;
  content?: ContentService;
  actions?: ActionCenterService;
  integrations?: IntegrationsService;
  traffic?: TrafficAnalyticsService;
  dashboard?: ExecutiveDashboardService;
  alerts?: AlertEngineService;
  reports?: ReportGeneratorService;
  billing?: BillingService;
  ledger?: CreditLedgerService;
  operator?: OperatorService;
  operatorSecretKey?: string;
  monitoringQueue?: Queue;
  origins: string[];
  logger: Logger;
  readiness: () => Promise<Readiness>;
  draining?: () => boolean;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestContext(options.logger));
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || options.origins.includes(origin)) return callback(null, true);
        callback(new ApiError(403, "Origin is not allowed", "ORIGIN_NOT_ALLOWED"));
      },
      credentials: true,
      exposedHeaders: ["X-Request-Id", "Retry-After"],
    }),
  );
  app.use(cookieParser());
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  if (options.auth) app.use("/v1/auth", authRoutes(options.auth));
  if (options.apiKeys && options.traffic && options.actions) {
    app.use("/v1/public", publicApiRoutes(options.apiKeys, options.traffic, options.actions));
  }
  if (options.auth && options.qa)
    app.use("/v1/projects/:projectId/qa", qaRoutes(options.auth, options.qa));
  if (options.auth && options.studio)
    app.use("/v1/projects/:projectId/studio", studioRoutes(options.auth, options.studio));
  if (options.auth && options.socialAnalytics)
    app.use(
      "/v1/projects/:projectId/performance-memory",
      socialAnalyticsRoutes(options.auth, options.socialAnalytics),
    );
  if (options.auth && options.projects)
    app.use("/v1/projects", projectRoutes(options.auth, options.projects));
  if (options.auth && options.projectManagement)
    app.use(
      "/v1/project-management",
      projectManagementRoutes(options.auth, options.projectManagement),
    );
  if (options.auth && options.onboarding)
    app.use(
      "/v1/onboarding",
      onboardingRoutes(options.auth, options.onboarding, options.monitoringQueue),
    );
  if (options.auth && options.monitoring)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/monitoring",
      monitoringRoutes(options.auth, options.monitoring),
    );
  if (options.auth && options.answers)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/answers",
      answerRoutes(options.auth, options.answers),
    );
  if (options.auth && options.visibility)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/visibility",
      visibilityRoutes(options.auth, options.visibility),
    );
  if (options.auth && options.citations)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/citations",
      citationRoutes(options.auth, options.citations),
    );
  if (options.auth && options.competitors)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/competitors",
      competitorRoutes(options.auth, options.competitors),
    );
  if (options.auth && options.technical)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/technical",
      technicalRoutes(options.auth, options.technical),
    );
  if (options.auth && options.axo)
    app.use("/v1/tenants/:tenantId/projects/:projectId/axo", axoRoutes(options.auth, options.axo));
  if (options.auth && options.content)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/content",
      contentRoutes(options.auth, options.content),
    );
  if (options.auth && options.actions)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/actions",
      actionCenterRoutes(options.auth, options.actions),
    );
  if (options.auth && options.integrations && options.traffic)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/integrations",
      integrationsRoutes(options.auth, options.integrations, options.traffic),
    );
  if (options.auth && options.dashboard && options.alerts && options.reports)
    app.use(
      "/v1/tenants/:tenantId/projects/:projectId/reporting",
      reportingRoutes(options.auth, options.dashboard, options.alerts, options.reports),
    );
  if (options.billing && options.ledger) {
    app.use(
      "/v1/billing",
      createBillingRoutes(options.billing, options.ledger, options.auth, options.origins),
    );
  }
  if (options.operator) {
    app.use("/v1/operator", createOperatorRoutes(options.operator, options.operatorSecretKey));
  }
  if (options.grader) {
    app.use("/v1/grader", graderRoutes(options.grader, { authService: options.auth?.service }));
  }
  app.use("/v1/health", healthRoutes(options.readiness, options.draining ?? (() => false)));
  app.get("/v1/openapi.json", (_req, res) =>
    res.json(
      getOpenApiDocument(
        Boolean(options.auth),
        Boolean(options.auth?.registration),
        Boolean(options.auth?.passwordReset),
        Boolean(options.auth && options.monitoring),
        Boolean(options.auth && options.projects),
        Boolean(options.auth && options.onboarding),
        Boolean(options.apiKeys && options.traffic && options.actions),
        Boolean(options.auth && options.qa),
        Boolean(options.auth && options.studio),
      ),
    ),
  );
  app.use((_req, _res, next) => next(new ApiError(404, "Resource not found", "NOT_FOUND")));
  app.use(createErrorHandler(options.logger));
  return app;
}
