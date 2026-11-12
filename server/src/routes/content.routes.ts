import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { ContentService } from "../services/content/content.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  listInventorySchema,
  listGapsSchema,
  comparePageSchema,
  createBriefSchema,
  updateBriefSchema,
  exportBriefSchema,
} from "../validations/content.validation.js";

export function contentRoutes(auth: AuthRouteOptions, service: ContentService) {
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
      res.locals.contentContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "content:" +
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

  // 1. List Content Inventory (CNT-FR-001)
  router.get(
    "/inventory",
    asyncHandler(async (req, res) => {
      const parsed = listInventorySchema.parse({ query: req.query });
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;

      const result = await service.getContentInventory(tenantId, projectId, parsed.query);
      res.json(new ApiResponse(200, "Content inventory retrieved", result));
    }),
  );

  // 2. Synchronize Inventory from Crawl Data (CNT-FR-001, CNT-FR-006, CNT-FR-007)
  router.post(
    "/inventory/sync",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;

      const result = await service.syncInventoryFromCrawl(tenantId, projectId);
      res.json(
        new ApiResponse(200, "Content inventory synchronized and mapped to prompts", result),
      );
    }),
  );

  // 3. List Content Gaps (CNT-FR-002)
  router.get(
    "/gaps",
    asyncHandler(async (req, res) => {
      const parsed = listGapsSchema.parse({ query: req.query });
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;

      const gaps = await service.getContentGaps(tenantId, projectId, parsed.query);
      res.json(new ApiResponse(200, "Content gaps retrieved", gaps));
    }),
  );

  // 4. Identify Content Gaps (CNT-FR-002)
  router.post(
    "/gaps/identify",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;

      const result = await service.identifyContentGaps(tenantId, projectId);
      res.json(new ApiResponse(200, "Content gaps identified", result));
    }),
  );

  // 5. Compare Owned Page Against Cited Competitor Page (CNT-FR-004)
  router.post(
    "/compare",
    asyncHandler(async (req, res) => {
      const parsed = comparePageSchema.parse({ body: req.body });
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;

      const comparison = await service.comparePageAgainstCompetitor(
        tenantId,
        projectId,
        parsed.body.ownedUrl,
        parsed.body.competitorUrl,
      );
      res.json(new ApiResponse(200, "Competitor page comparison completed", comparison));
    }),
  );

  // 6. Create Content Brief (CNT-FR-005, CNT-FR-008, CNT-FR-009)
  router.post(
    "/briefs",
    asyncHandler(async (req, res) => {
      const parsed = createBriefSchema.parse({ body: req.body });
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;

      const brief = await service.createBrief(tenantId, projectId, parsed.body);
      res.status(201).json(new ApiResponse(201, "Content brief created successfully", brief));
    }),
  );

  // 7. List Content Briefs
  router.get(
    "/briefs",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;

      const briefs = await service.listBriefs(tenantId, projectId);
      res.json(new ApiResponse(200, "Content briefs retrieved", briefs));
    }),
  );

  // 8. Get Specific Content Brief
  router.get(
    "/briefs/:briefId",
    asyncHandler(async (req, res) => {
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;
      const briefId = String(req.params.briefId);

      const brief = await service.getBrief(tenantId, projectId, briefId);
      res.json(new ApiResponse(200, "Content brief retrieved", brief));
    }),
  );

  // 9. Update Content Brief
  router.patch(
    "/briefs/:briefId",
    asyncHandler(async (req, res) => {
      const parsed = updateBriefSchema.parse({ body: req.body });
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;
      const briefId = String(req.params.briefId);

      const updated = await service.updateBrief(tenantId, projectId, briefId, parsed.body);
      res.json(new ApiResponse(200, "Content brief updated", updated));
    }),
  );

  // 10. Export Content Brief (CNT-F1: Markdown / DOCX)
  router.get(
    "/briefs/:briefId/export",
    asyncHandler(async (req, res) => {
      const parsed = exportBriefSchema.parse({ query: req.query });
      const { tenantId } = res.locals.contentContext;
      const projectId = res.locals.projectId as string;
      const briefId = String(req.params.briefId);

      const exported = await service.exportBrief(tenantId, projectId, briefId, parsed.query.format);

      res.setHeader("Content-Type", exported.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
      res.send(exported.content);
    }),
  );

  return router;
}
