import { z } from "zod";

export const checkoutSessionInput = z.object({
  planTier: z.enum(["starter", "growth", "enterprise", "topup_1000"]),
  returnUrl: z.string().url(),
});

export const portalSessionInput = z.object({
  returnUrl: z.string().url(),
});

export const listLedgerInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.enum(["monitoring", "crawl"]).optional(),
});
