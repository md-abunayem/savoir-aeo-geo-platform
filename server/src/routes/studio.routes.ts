import { Router } from "express";
import { z } from "zod";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { ApprovalService } from "../services/publishing/approval.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import {
  studioDocumentSchema,
  studioInputSchema,
} from "../services/content/content-studio.schema.js";
import { revisionSchema } from "../services/publishing/publishing.validation.js";

export function studioRoutes(auth: AuthRouteOptions, service: ApprovalService) {
  const router = Router({ mergeParams: true });
  const csrf = createCsrf(auth.csrfSecret, auth.secureCookies);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(authenticate(auth.service));
  router.use((req, res, next) => (req.method === "GET" ? next() : csrf.verify(req, res, next)));
  router.use(
    asyncHandler(async (req, res, next) => {
      res.locals.studioProjectId = z.uuid().parse(req.params.projectId);
      let limit;
      try {
        limit = await auth.limiter.consume(
          `studio:${res.locals.user.id}:${req.method === "GET" ? "read" : "write"}`,
          req.method === "GET" ? 120 : 20,
          60,
        );
      } catch {
        throw new ApiError(503, "Studio temporarily unavailable", "STUDIO_UNAVAILABLE");
      }
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfter));
        throw new ApiError(429, "Too many requests", "RATE_LIMITED");
      }
      next();
    }),
  );
  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Content studio",
          await service.list(res.locals.user.id, res.locals.studioProjectId),
        ),
      );
    }),
  );
  router.post(
    "/generate",
    asyncHandler(async (req, res) => {
      const input = studioInputSchema.parse(req.body);
      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            "Draft generated",
            await service.generate(res.locals.user.id, res.locals.studioProjectId, input),
          ),
        );
    }),
  );
  router.post(
    "/drafts",
    asyncHandler(async (req, res) => {
      const input = z.object({ document: studioDocumentSchema }).strict().parse(req.body);
      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            "Draft saved",
            await service.create(res.locals.user.id, res.locals.studioProjectId, input.document),
          ),
        );
    }),
  );
  router.put(
    "/drafts/:id",
    asyncHandler(async (req, res) => {
      const input = revisionSchema.extend({ document: studioDocumentSchema }).parse(req.body);
      res.json(
        new ApiResponse(
          200,
          "Draft updated; approval cleared",
          await service.edit(
            res.locals.user.id,
            res.locals.studioProjectId,
            z.uuid().parse(req.params.id),
            input.revision,
            input.document,
          ),
        ),
      );
    }),
  );
  for (const command of ["review", "approve"] as const)
    router.post(
      `/drafts/:id/${command}`,
      asyncHandler(async (req, res) => {
        const input = revisionSchema.parse(req.body);
        res.json(
          new ApiResponse(
            200,
            `Draft ${command} complete`,
            await service[command](
              res.locals.user.id,
              res.locals.studioProjectId,
              z.uuid().parse(req.params.id),
              input.revision,
            ),
          ),
        );
      }),
    );
  router.post(
    "/drafts/:id/schedule",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Draft scheduled",
          await service.schedule(
            res.locals.user.id,
            res.locals.studioProjectId,
            z.uuid().parse(req.params.id),
            req.body,
          ),
        ),
      );
    }),
  );
  router.post(
    "/connections/:provider",
    asyncHandler(async (req, res) => {
      const provider = z.enum(["buffer", "wordpress"]).parse(req.params.provider);
      res.json(
        new ApiResponse(
          200,
          "Publishing account connected",
          await service.connect(res.locals.user.id, res.locals.studioProjectId, provider, req.body),
        ),
      );
    }),
  );
  router.post(
    "/media",
    asyncHandler(async (req, res) => {
      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            "Upload prepared",
            await service.prepareMedia(res.locals.user.id, res.locals.studioProjectId, req.body),
          ),
        );
    }),
  );
  router.post(
    "/media/:id/complete",
    asyncHandler(async (req, res) => {
      res.json(
        new ApiResponse(
          200,
          "Public media ready",
          await service.completeMedia(
            res.locals.user.id,
            res.locals.studioProjectId,
            z.uuid().parse(req.params.id),
          ),
        ),
      );
    }),
  );
  return router;
}
