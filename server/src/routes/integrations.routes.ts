import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { IntegrationsService } from "../services/integrations/integrations.service.js";
import type { TrafficAnalyticsService } from "../services/integrations/traffic-analytics.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  connectProviderSchema,
  disconnectProviderSchema,
  createApiKeySchema,
  createWebhookSchema,
  trafficOverviewQuerySchema,
  gscQuerySchema,
} from "../validations/integrations.validation.js";

export function integrationsRoutes(
  auth: AuthRouteOptions,
  service: IntegrationsService,
  trafficService: TrafficAnalyticsService,
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
      res.locals.integrationContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "integrations:" +
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

  // 1. List connections (ITG-FR-010)
  router.get(
    "/connections",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;

      const connections = await service.listConnections(projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Integration connections retrieved successfully.", connections));
    }),
  );

  // 2. Connect provider (ITG-FR-001, ITG-FR-002, ITG-FR-011)
  router.post(
    "/connections",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const body = connectProviderSchema.parse(req.body);

      const connection = await service.connectProvider(projectId, tenantId, body);
      return res
        .status(200)
        .json(new ApiResponse(200, "Provider connected successfully.", connection));
    }),
  );

  // 3. Disconnect provider (ITG-FR-010)
  router.delete(
    "/connections/:connectionId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const connectionId = String(req.params.connectionId);
      const body = disconnectProviderSchema.parse(req.body || {});

      const result = await service.disconnectProvider(
        connectionId,
        projectId,
        tenantId,
        body.purgeData,
      );
      return res
        .status(200)
        .json(new ApiResponse(200, "Provider disconnected successfully.", result));
    }),
  );

  // 4. Trigger manual sync (ITG-FR-001, ITG-FR-002)
  router.post(
    "/connections/:connectionId/sync",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const connectionId = String(req.params.connectionId);

      const conns = await service.listConnections(projectId, tenantId);
      const conn = conns.find((c) => c.id === connectionId);
      if (!conn) throw new ApiError(404, "Connection not found");

      let result;
      if (conn.provider === "google_search_console") {
        result = await service.syncGsc(projectId, tenantId, connectionId);
      } else if (conn.provider === "google_analytics_4") {
        result = await service.syncGa4(projectId, tenantId, connectionId);
      } else {
        throw new ApiError(
          422,
          "Sync is supported for Google Analytics and Search Console only",
          "UNSUPPORTED_SYNC_PROVIDER",
        );
      }

      return res.status(200).json(new ApiResponse(200, "Sync executed successfully.", result));
    }),
  );

  // 5. List API keys (ITG-FR-005, ITG-FR-012)
  router.get(
    "/keys",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;

      const keys = await service.listApiKeys(projectId, tenantId);
      return res.status(200).json(new ApiResponse(200, "API keys retrieved successfully.", keys));
    }),
  );

  // 6. Create API key (ITG-FR-005, ITG-FR-012)
  router.post(
    "/keys",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const body = createApiKeySchema.parse(req.body);

      const apiKey = await service.createApiKey(
        projectId,
        tenantId,
        body.name,
        body.scopes,
        body.rateLimitRpm,
      );
      return res
        .status(201)
        .json(
          new ApiResponse(201, "API key created successfully. Save your secret key now.", apiKey),
        );
    }),
  );

  // 7. Revoke API key (ITG-FR-005)
  router.delete(
    "/keys/:keyId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const keyId = String(req.params.keyId);

      const result = await service.revokeApiKey(keyId, projectId, tenantId);
      return res.status(200).json(new ApiResponse(200, "API key revoked successfully.", result));
    }),
  );

  // 8. List webhooks (ITG-FR-006)
  router.get(
    "/webhooks",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;

      const webhooks = await service.listWebhooks(projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Webhook endpoints retrieved successfully.", webhooks));
    }),
  );

  // 9. Create webhook (ITG-FR-006)
  router.post(
    "/webhooks",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const body = createWebhookSchema.parse(req.body);

      const webhook = await service.createWebhook(
        projectId,
        tenantId,
        body.url,
        body.events,
        body.description,
      );
      return res
        .status(201)
        .json(new ApiResponse(201, "Webhook endpoint registered successfully.", webhook));
    }),
  );

  // 10. Delete webhook (ITG-FR-006)
  router.delete(
    "/webhooks/:webhookId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const webhookId = String(req.params.webhookId);

      const result = await service.deleteWebhook(webhookId, projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Webhook endpoint deleted successfully.", result));
    }),
  );

  // 11. Test dispatch webhook (ITG-FR-006)
  router.post(
    "/webhooks/:webhookId/test",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const webhookId = String(req.params.webhookId);

      const result = await service.testDispatchWebhook(webhookId, projectId, tenantId);
      return res
        .status(200)
        .json(new ApiResponse(200, "Test webhook dispatched successfully.", result));
    }),
  );

  // 12. AI Traffic Analytics Overview (M11 / TRF-FR-001, TRF-FR-002, TRF-FR-003, TRF-FR-008)
  router.get(
    "/traffic/overview",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const query = trafficOverviewQuerySchema.parse(req.query);

      const overview = await trafficService.getOverview(projectId, tenantId, query.days);
      return res
        .status(200)
        .json(new ApiResponse(200, "AI Traffic overview retrieved successfully.", overview));
    }),
  );

  // 13. GSC Search Performance & Prompt Opportunities (M11 / TRF-FR-004, M14 / ITG-FR-001)
  router.get(
    "/traffic/gsc",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.integrationContext;
      const { projectId } = res.locals;
      const query = gscQuerySchema.parse(req.query);

      const gscData = await trafficService.getGscData(projectId, tenantId, query.questionOnly);
      return res
        .status(200)
        .json(new ApiResponse(200, "GSC search performance data retrieved successfully.", gscData));
    }),
  );

  return router;
}
