import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { CompetitorService } from "../services/analytics/competitor.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  createCompetitorSchema,
  updateCompetitorSchema,
  competitorQuerySchema,
  candidateListQuerySchema,
  exportCompetitorQuerySchema,
} from "../validations/competitor.validation.js";

export function competitorRoutes(auth: AuthRouteOptions, service: CompetitorService) {
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
      res.locals.competitorContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "competitor:" +
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

  // 1. List competitors (CMP-FR-001)
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = competitorQuerySchema.parse({ query: req.query });
      const items = await service.listCompetitors(
        res.locals.competitorContext,
        res.locals.projectId,
        parsed.query,
      );
      res.json(new ApiResponse(200, "Competitors retrieved successfully", { items }));
    }),
  );

  router.get(
    "/topics",
    asyncHandler(async (_req, res) => {
      const topics = await service.listTopics(res.locals.competitorContext, res.locals.projectId);
      res.json(new ApiResponse(200, "Competitor topics retrieved successfully", { topics }));
    }),
  );

  // 2. Create competitor (CMP-FR-001, CMP-FR-008)
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = createCompetitorSchema.parse({ body: req.body });
      const item = await service.createCompetitor(
        res.locals.competitorContext,
        res.locals.projectId,
        parsed.body,
      );
      res.status(201).json(new ApiResponse(201, "Competitor created successfully", { item }));
    }),
  );

  // 3. Competitor Leaderboard (CMP-FR-004, CMP-FR-002)
  router.get(
    "/leaderboard",
    asyncHandler(async (req, res) => {
      const parsed = competitorQuerySchema.parse({ query: req.query });
      const items = await service.getLeaderboard(
        res.locals.competitorContext,
        res.locals.projectId,
        parsed.query,
      );
      res.json(new ApiResponse(200, "Leaderboard retrieved successfully", { items }));
    }),
  );

  // 4. Competitive Gaps (CMP-FR-005, CMP-FR-012)
  router.get(
    "/gaps",
    asyncHandler(async (req, res) => {
      const parsed = competitorQuerySchema.parse({ query: req.query });
      const items = await service.getCompetitiveGaps(
        res.locals.competitorContext,
        res.locals.projectId,
        parsed.query,
      );
      res.json(new ApiResponse(200, "Competitive gaps retrieved successfully", { items }));
    }),
  );

  // 5. Competitor Candidates & Auto-Discovery (CMP-FR-010, CMP-FR-016)
  router.get(
    "/candidates",
    asyncHandler(async (req, res) => {
      const parsed = candidateListQuerySchema.parse({ query: req.query });
      const items = await service.listCandidates(
        res.locals.competitorContext,
        res.locals.projectId,
        parsed.query.status,
      );
      res.json(new ApiResponse(200, "Candidates retrieved successfully", { items }));
    }),
  );

  router.post(
    "/candidates/discover",
    asyncHandler(async (_req, res) => {
      const items = await service.runCompetitorAutoDiscovery(
        res.locals.competitorContext,
        res.locals.projectId,
      );
      res.json(
        new ApiResponse(200, "Competitor auto-discovery completed", {
          discoveredCount: items.length,
          items,
        }),
      );
    }),
  );

  router.post(
    "/candidates/:id/accept",
    asyncHandler(async (req, res) => {
      const item = await service.acceptCandidate(
        res.locals.competitorContext,
        res.locals.projectId,
        String(req.params.id),
      );
      res.json(new ApiResponse(200, "Candidate accepted and tracked as competitor", { item }));
    }),
  );

  router.post(
    "/candidates/:id/reject",
    asyncHandler(async (req, res) => {
      await service.rejectCandidate(
        res.locals.competitorContext,
        res.locals.projectId,
        String(req.params.id),
      );
      res.json(new ApiResponse(200, "Candidate rejected for 90 days", null));
    }),
  );

  router.post(
    "/candidates/:id/snooze",
    asyncHandler(async (req, res) => {
      await service.snoozeCandidate(
        res.locals.competitorContext,
        res.locals.projectId,
        String(req.params.id),
      );
      res.json(new ApiResponse(200, "Candidate snoozed for 30 days", null));
    }),
  );

  // 6. CSV Export (RFC 4180)
  router.get(
    "/export",
    asyncHandler(async (req, res) => {
      const parsed = exportCompetitorQuerySchema.parse({ query: req.query });
      const csv = await service.exportCsv(
        res.locals.competitorContext,
        res.locals.projectId,
        parsed.query.type,
        parsed.query,
        parsed.query.competitorId,
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="competitors-${parsed.query.type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.status(200).send(csv);
    }),
  );

  // 7. Single Competitor & Head-to-Head
  router.get(
    "/:competitorId",
    asyncHandler(async (req, res) => {
      const item = await service.getCompetitor(
        res.locals.competitorContext,
        res.locals.projectId,
        String(req.params.competitorId),
      );
      res.json(new ApiResponse(200, "Competitor retrieved successfully", { item }));
    }),
  );

  router.patch(
    "/:competitorId",
    asyncHandler(async (req, res) => {
      const parsed = updateCompetitorSchema.parse({ body: req.body });
      const item = await service.updateCompetitor(
        res.locals.competitorContext,
        res.locals.projectId,
        String(req.params.competitorId),
        parsed.body,
      );
      res.json(new ApiResponse(200, "Competitor updated successfully", { item }));
    }),
  );

  router.delete(
    "/:competitorId",
    asyncHandler(async (req, res) => {
      await service.deleteCompetitor(
        res.locals.competitorContext,
        res.locals.projectId,
        String(req.params.competitorId),
      );
      res.json(new ApiResponse(200, "Competitor deleted successfully", null));
    }),
  );

  router.get(
    "/:competitorId/head-to-head",
    asyncHandler(async (req, res) => {
      const parsed = competitorQuerySchema.parse({ query: req.query });
      const data = await service.getHeadToHead(
        res.locals.competitorContext,
        res.locals.projectId,
        String(req.params.competitorId),
        parsed.query,
      );
      res.json(new ApiResponse(200, "Head-to-head comparison retrieved successfully", data));
    }),
  );

  return router;
}
