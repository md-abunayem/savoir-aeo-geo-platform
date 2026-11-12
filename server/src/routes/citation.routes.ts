import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { CitationService } from "../services/analytics/citation.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  citationQuerySchema,
  listDomainsQuerySchema,
  listPagesQuerySchema,
  citationGapQuerySchema,
  sourceDomainInputSchema,
  updateBrokenCitationInputSchema,
} from "../validations/citation.validation.js";

export function citationRoutes(auth: AuthRouteOptions, service: CitationService) {
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
      res.locals.citationContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "citation:" +
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

  // 1. Citation Overview (CIT-FR-001 to CIT-FR-004)
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const query = citationQuerySchema.parse(req.query);

      if (query.format === "csv") {
        const csv = await service.exportCsv(
          res.locals.citationContext,
          res.locals.projectId,
          query.type,
          query,
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="citations-${query.type}.csv"`);
        res.status(200).send(csv);
        return;
      }

      const overview = await service.getCitationOverview(
        res.locals.citationContext,
        res.locals.projectId,
        query,
      );
      res.json(new ApiResponse(200, "Citation overview retrieved", overview));
    }),
  );

  // 2. Domain Citations Aggregation & Trend Tracking (CIT-FR-003, CIT-FR-006)
  router.get(
    "/domains",
    asyncHandler(async (req, res) => {
      const query = listDomainsQuerySchema.parse(req.query);

      if (query.format === "csv") {
        const csv = await service.exportCsv(
          res.locals.citationContext,
          res.locals.projectId,
          "domains",
          query,
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="domain-citations.csv"');
        res.status(200).send(csv);
        return;
      }

      const domains = await service.listDomainCitations(
        res.locals.citationContext,
        res.locals.projectId,
        query,
      );
      res.json(new ApiResponse(200, "Domain citations retrieved", domains));
    }),
  );

  // 3. Page Citations Aggregation (CIT-FR-003, CIT-FR-004)
  router.get(
    "/pages",
    asyncHandler(async (req, res) => {
      const query = listPagesQuerySchema.parse(req.query);

      if (query.format === "csv") {
        const csv = await service.exportCsv(
          res.locals.citationContext,
          res.locals.projectId,
          "pages",
          query,
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="page-citations.csv"');
        res.status(200).send(csv);
        return;
      }

      const pages = await service.listPageCitations(
        res.locals.citationContext,
        res.locals.projectId,
        query,
      );
      res.json(new ApiResponse(200, "Page citations retrieved", pages));
    }),
  );

  // 4. Citation Gap Analysis (CIT-FR-005, Feature CIT-F1 & CIT-FR-008)
  router.get(
    "/gaps",
    asyncHandler(async (req, res) => {
      const query = citationGapQuerySchema.parse(req.query);

      if (query.format === "csv") {
        const csv = await service.exportCsv(
          res.locals.citationContext,
          res.locals.projectId,
          "gaps",
          query,
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="citation-gaps.csv"');
        res.status(200).send(csv);
        return;
      }

      const gaps = await service.getCitationGaps(
        res.locals.citationContext,
        res.locals.projectId,
        query,
      );
      res.json(new ApiResponse(200, "Citation gaps retrieved", gaps));
    }),
  );

  // 5. Broken Citations Detection & Management (CIT-FR-009)
  router.get(
    "/broken",
    asyncHandler(async (req, res) => {
      const broken = await service.listBrokenCitations(
        res.locals.citationContext,
        res.locals.projectId,
        { taskStatus: req.query.status as string | undefined },
      );
      res.json(new ApiResponse(200, "Broken citations retrieved", broken));
    }),
  );

  router.post(
    "/broken/detect",
    asyncHandler(async (_req, res) => {
      const result = await service.detectBrokenBrandCitations(
        res.locals.citationContext,
        res.locals.projectId,
      );
      res.json(new ApiResponse(200, "Broken brand citations check completed", result));
    }),
  );

  router.patch(
    "/broken/:id",
    asyncHandler(async (req, res) => {
      const body = updateBrokenCitationInputSchema.parse(req.body);
      const updated = await service.updateBrokenCitationStatus(
        res.locals.citationContext,
        res.locals.projectId,
        String(req.params.id),
        body.status,
      );
      res.json(new ApiResponse(200, "Broken citation task updated", updated));
    }),
  );

  // 6. Source Domain Rules & Overrides (CIT-FR-010)
  router.get(
    "/sources",
    asyncHandler(async (_req, res) => {
      const sources = await service.listSourceDomains(
        res.locals.citationContext,
        res.locals.projectId,
      );
      res.json(new ApiResponse(200, "Source domain rules retrieved", sources));
    }),
  );

  router.post(
    "/sources",
    asyncHandler(async (req, res) => {
      const body = sourceDomainInputSchema.parse(req.body);
      const source = await service.upsertSourceDomain(
        res.locals.citationContext,
        res.locals.projectId,
        body,
      );
      res.status(201).json(new ApiResponse(201, "Source domain rule saved", source));
    }),
  );

  router.delete(
    "/sources/:id",
    asyncHandler(async (req, res) => {
      const result = await service.deleteSourceDomain(
        res.locals.citationContext,
        res.locals.projectId,
        String(req.params.id),
      );
      res.json(new ApiResponse(200, "Source domain rule deleted", result));
    }),
  );

  // 7. CSV Export Endpoint (CIT-FR-011)
  router.get(
    "/export",
    asyncHandler(async (req, res) => {
      const query = citationQuerySchema.parse(req.query);
      const csv = await service.exportCsv(
        res.locals.citationContext,
        res.locals.projectId,
        query.type,
        query,
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="citations-${query.type}.csv"`);
      res.status(200).send(csv);
    }),
  );

  return router;
}
