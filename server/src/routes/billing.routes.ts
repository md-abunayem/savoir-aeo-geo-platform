import { Router } from "express";
import type { Request, Response } from "express";
import express from "express";
import type { AuthRouteOptions } from "./auth.routes.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import {
  checkoutSessionInput,
  portalSessionInput,
  listLedgerInput,
} from "../validations/billing.validation.js";
import type { BillingService } from "../services/billing/billing.service.js";
import type { CreditLedgerService } from "../services/billing/credit-ledger.service.js";

export function createBillingRoutes(
  billingService: BillingService,
  _ledgerService: CreditLedgerService,
  auth?: AuthRouteOptions,
  allowedOrigins: string[] = [],
): Router {
  const router = Router();

  // 1. Stripe Webhook (Unauthenticated, verified via HMAC signature header)
  router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    asyncHandler(async (req: Request, res: Response) => {
      const signature = req.headers["stripe-signature"] as string | undefined;
      if (!signature) {
        throw new ApiError(400, "Missing stripe-signature header", "MISSING_SIGNATURE");
      }

      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? req.body;
      if (!Buffer.isBuffer(rawBody) && typeof rawBody !== "string") {
        throw new ApiError(400, "Original webhook payload required", "INVALID_PAYLOAD");
      }
      const result = await billingService.handleWebhook(rawBody, signature);
      return res.status(200).json(result);
    }),
  );

  router.use("/tenants/:tenantId", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!auth) return next(new ApiError(401, "Authentication required", "AUTH_REQUIRED"));
    next();
  });
  if (auth) {
    const csrf = createCsrf(auth.csrfSecret, auth.secureCookies);
    router.use(
      "/tenants/:tenantId",
      authenticate(auth.service),
      (req, res, next) => (req.method === "GET" ? next() : csrf.verify(req, res, next)),
      asyncHandler(async (req, res, next) => {
        const tenantId = z.uuid().parse(req.params.tenantId);
        await billingService.authorizeOwner(tenantId, res.locals.user.id);
        if (req.body?.returnUrl) {
          let origin: string;
          try {
            origin = new URL(req.body.returnUrl).origin;
          } catch {
            throw new ApiError(400, "Invalid return URL", "INVALID_RETURN_URL");
          }
          if (!allowedOrigins.includes(origin)) {
            throw new ApiError(
              400,
              "Return URL must use an application origin",
              "INVALID_RETURN_URL",
            );
          }
        }
        next();
      }),
    );
  }

  // 2. Tenant Billing Overview (ADM-FR-001, ADM-FR-004)
  router.get(
    "/tenants/:tenantId/overview",
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = String(req.params.tenantId);
      const overview = await billingService.forOwner(tenantId, res.locals.user.id, (billing) =>
        billing.getBillingOverview(tenantId),
      );
      return res.json(new ApiResponse(200, "Billing overview retrieved successfully.", overview));
    }),
  );

  // 3. Create Stripe Checkout Session (ADM-FR-004)
  router.post(
    "/tenants/:tenantId/checkout",
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = String(req.params.tenantId);
      const body = checkoutSessionInput.parse(req.body);
      const userId = res.locals.user.id;

      const session = await billingService.forOwner(tenantId, userId, (billing) =>
        billing.createCheckoutSession({
          tenantId,
          userId,
          planTier: body.planTier,
          returnUrl: body.returnUrl,
        }),
      );

      return res.json(new ApiResponse(200, "Stripe checkout session created.", session));
    }),
  );

  // 4. Create Stripe Customer Portal Session (ADM-FR-005)
  router.post(
    "/tenants/:tenantId/portal",
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = String(req.params.tenantId);
      const body = portalSessionInput.parse(req.body);

      const portal = await billingService.forOwner(tenantId, res.locals.user.id, (billing) =>
        billing.createPortalSession(tenantId, body.returnUrl),
      );
      return res.json(new ApiResponse(200, "Stripe billing portal session created.", portal));
    }),
  );

  // 5. Query Tenant Credit Ledger History (ADM-FR-002, ADM-FR-003)
  router.get(
    "/tenants/:tenantId/ledger",
    asyncHandler(async (req: Request, res: Response) => {
      const tenantId = String(req.params.tenantId);
      const query = listLedgerInput.parse(req.query);

      const entries = await billingService.forOwner(
        tenantId,
        res.locals.user.id,
        (_billing, ledger) => ledger.getLedgerHistory(tenantId, query),
      );
      return res.json(new ApiResponse(200, "Credit ledger entries retrieved.", entries));
    }),
  );

  return router;
}
