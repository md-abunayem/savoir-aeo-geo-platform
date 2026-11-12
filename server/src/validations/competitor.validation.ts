import { z } from "zod";

const queryBoolean = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean().optional(),
);

export const createCompetitorSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required").max(150),
    domain: z.string().trim().min(1, "Domain is required"),
    aliases: z.array(z.string().trim().min(1)).max(25).optional(),
    competitorType: z.enum(["direct", "indirect", "aspirational"]).optional().default("direct"),
    rationale: z.string().max(1000).optional(),
  }),
});

export const updateCompetitorSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(150).optional(),
    domain: z.string().trim().min(1).optional(),
    aliases: z.array(z.string().trim().min(1)).max(25).optional(),
    competitorType: z.enum(["direct", "indirect", "aspirational"]).optional(),
    rationale: z.string().max(1000).optional().nullable(),
  }),
});

export const competitorQuerySchema = z.object({
  query: z.object({
    days: z.coerce.number().int().positive().optional(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    engine: z.string().optional(),
    topic: z.string().optional(),
    nonBrandedOnly: queryBoolean,
    search: z.string().optional(),
  }),
});

export const candidateListQuerySchema = z.object({
  query: z.object({
    status: z.enum(["suggested", "accepted", "rejected", "snoozed"]).optional(),
  }),
});

export const exportCompetitorQuerySchema = z.object({
  query: z.object({
    type: z.enum(["leaderboard", "head_to_head", "gaps"]).default("leaderboard"),
    competitorId: z.string().uuid().optional(),
    days: z.coerce.number().int().positive().optional(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    engine: z.string().optional(),
    topic: z.string().optional(),
    nonBrandedOnly: queryBoolean,
  }),
});
