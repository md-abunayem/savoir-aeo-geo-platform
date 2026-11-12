import { z } from "zod";

export const searchTenantsInput = z.object({
  query: z.string().optional(),
  planTier: z.enum(["starter", "growth", "enterprise", "all"]).optional(),
  status: z.enum(["active", "paused", "archived", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const updateTenantStatusInput = z.object({
  status: z.enum(["active", "paused", "archived"]),
  reason: z.string().min(3).max(500),
});

export const adjustCreditsInput = z.object({
  category: z.enum(["monitoring", "crawl"]),
  amount: z
    .number()
    .int()
    .refine((val) => val !== 0, "Amount must not be zero"),
  reason: z.string().min(3).max(500),
});

export const listAuditLogsInput = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  targetTenantId: z.string().uuid().optional(),
});
