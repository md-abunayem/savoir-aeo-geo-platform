import { Router } from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { AxoService } from "../services/axo/axo.service.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { projectParams } from "../validations/monitoring.validation.js";
import {
  validateLlmsSchema,
  generateRobotsSchema,
  savePolicySchema,
} from "../validations/axo.validation.js";

export function axoRoutes(auth: AuthRouteOptions, service: AxoService) {
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
      res.locals.axoContext = {
        tenantId: p.tenantId,
        userId: res.locals.user.id,
        role: res.locals.user.role,
      };
      res.locals.projectId = p.projectId;

      let limit;
      try {
        limit = await auth.limiter.consume(
          "axo:" +
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

  // 1. Get Project Agent Policy (AXO-FR-003, AXO-FR-009)
  router.get(
    "/policy",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.axoContext;
      const projectId = res.locals.projectId as string;

      const policy = await service.getPolicy(tenantId, projectId);
      res.json(new ApiResponse(200, "Agent policy retrieved successfully", policy));
    }),
  );

  // 2. Save/Update Project Agent Policy (AXO-FR-003, AXO-FR-009)
  router.post(
    "/policy",
    asyncHandler(async (req, res) => {
      const parsed = savePolicySchema.parse({ body: req.body });
      const { tenantId } = res.locals.axoContext;
      const projectId = res.locals.projectId as string;

      const policy = await service.savePolicy(tenantId, projectId, parsed.body);
      res.json(new ApiResponse(200, "Agent policy saved successfully", policy));
    }),
  );

  // 3. Live Validate /llms.txt & /llms-full.txt (AXO-FR-001, AXO-FR-002)
  router.post(
    "/llms/validate",
    asyncHandler(async (req, res) => {
      const parsed = validateLlmsSchema.parse({ body: req.body });
      const { tenantId } = res.locals.axoContext;
      const projectId = res.locals.projectId as string;

      const result = await service.validateLiveLlms(tenantId, projectId, parsed.body.targetUrl);
      res.json(new ApiResponse(200, "LLMS.txt validation completed", result));
    }),
  );

  // 4. Generate Robots.txt and Compute Diff (AXO-FR-003, AXO-FR-004, AXO-FR-005)
  router.post(
    "/robots/generate",
    asyncHandler(async (req, res) => {
      const parsed = generateRobotsSchema.parse({ body: req.body });
      const { tenantId } = res.locals.axoContext;
      const projectId = res.locals.projectId as string;

      const result = await service.generateRobotsPolicy(tenantId, projectId, parsed.body);
      res.json(new ApiResponse(200, "Robots.txt AI policy generated", result));
    }),
  );

  // 5. Generate Draft /llms.txt & Schema.org Templates (AXO-FR-006, AXO-FR-007, AXO-FR-008)
  router.post(
    "/drafts/generate",
    asyncHandler(async (_req, res) => {
      const { tenantId } = res.locals.axoContext;
      const projectId = res.locals.projectId as string;

      const result = await service.generateDrafts(tenantId, projectId);
      res.json(new ApiResponse(200, "Drafts generated successfully", result));
    }),
  );

  return router;
}
