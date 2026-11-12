import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { AnswerService } from "../services/answer/answer.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  listAnswersQuerySchema,
  compareAnswersQuerySchema,
  flagAnswerInputSchema,
  reviewMentionInputSchema,
} from "../validations/answer.validation.js";

export function answerRoutes(auth: AuthRouteOptions, service: AnswerService) {
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
      res.locals.answerContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "answer:" +
            res.locals.user.id +
            ":" +
            p.projectId +
            (req.method === "GET" ? ":read" : ":write"),
          req.method === "GET" ? 120 : 20,
          60,
        );
      } catch {
        throw new ApiError(503, "Rate limiter unavailable", "RATE_LIMITER_UNAVAILABLE");
      }
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfter));
        throw new ApiError(429, "Too many requests", "RATE_LIMITED");
      }
      next();
    }),
  );

  // List answers (filter, pagination, full-text search, CSV export)
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const query = listAnswersQuerySchema.parse(req.query);
      const result = await service.listAnswers(
        res.locals.answerContext,
        res.locals.projectId,
        query,
      );

      if ("csv" in result) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="answers-export.csv"');
        res.status(200).send(result.csv);
        return;
      }

      res.json(new ApiResponse(200, "Answers retrieved", result));
    }),
  );

  // Compare answers (cross-engine prompt compare ANS-FR-005 or timeline diff ANS-FR-004)
  router.get(
    "/compare",
    asyncHandler(async (req, res) => {
      const query = compareAnswersQuerySchema.parse(req.query);
      const comparison = await service.compareAnswers(
        res.locals.answerContext,
        res.locals.projectId,
        query,
      );
      res.json(new ApiResponse(200, "Answer comparison generated", comparison));
    }),
  );

  // Answer detail view (ANS-FR-002, ANS-FR-003, ANS-FR-010, ANS-FR-011)
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const answer = await service.getAnswerById(
        res.locals.answerContext,
        res.locals.projectId,
        String(req.params.id),
      );
      res.json(new ApiResponse(200, "Answer details retrieved", answer));
    }),
  );

  // Flag an answer as inaccurate/misleading (ANS-FR-007)
  router.post(
    "/:id/flag",
    asyncHandler(async (req, res) => {
      const input = flagAnswerInputSchema.parse(req.body);
      const flag = await service.flagAnswer(
        res.locals.answerContext,
        res.locals.projectId,
        String(req.params.id),
        input,
      );
      res.status(201).json(new ApiResponse(201, "Answer flagged for review", flag));
    }),
  );

  // Review a mention (verified or false positive) (Feature ANS-F1)
  router.patch(
    "/:id/mentions/:mentionId",
    asyncHandler(async (req, res) => {
      const input = reviewMentionInputSchema.parse(req.body);
      const updated = await service.reviewMention(
        res.locals.answerContext,
        res.locals.projectId,
        String(req.params.id),
        String(req.params.mentionId),
        input.reviewStatus,
      );
      res.json(new ApiResponse(200, "Mention review updated", updated));
    }),
  );

  return router;
}
