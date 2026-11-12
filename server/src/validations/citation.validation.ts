import { z } from "zod";

export const citationQuerySchema = z
  .object({
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dateFrom must be YYYY-MM-DD")
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dateTo must be YYYY-MM-DD")
      .optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    engine: z
      .enum(["all", "openai", "gemini", "google_ai_overviews", "google_ai_mode", "openrouter"])
      .optional(),
    sourceType: z.string().optional(),
    format: z.enum(["json", "csv"]).default("json"),
    type: z.enum(["domains", "pages", "gaps", "broken"]).default("domains"),
  })
  .strict();

export const listDomainsQuerySchema = z
  .object({
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    engine: z.string().optional(),
    sourceType: z.string().optional(),
    search: z.string().max(100).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict();

export const listPagesQuerySchema = z
  .object({
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    engine: z.string().optional(),
    domain: z.string().max(255).optional(),
    onlyBrandPages: z
      .string()
      .transform((v) => v === "true")
      .optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict();

export const citationGapQuerySchema = z
  .object({
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    engine: z.string().optional(),
    minOpportunityScore: z.coerce.number().min(0).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict();

export const sourceDomainInputSchema = z
  .object({
    domain: z.string().trim().min(1).max(255),
    sourceType: z
      .enum([
        "brand",
        "competitor",
        "news_media",
        "review_comparison",
        "forum_ugc",
        "social",
        "encyclopedia",
        "government_education",
        "marketplace",
        "documentation_blog",
        "other",
      ])
      .default("other"),
    isAllowed: z.boolean().default(true),
    isDenied: z.boolean().default(false),
    notes: z.string().max(500).optional(),
  })
  .strict();

export const updateBrokenCitationInputSchema = z
  .object({
    status: z.enum(["open", "resolved", "ignored"]),
  })
  .strict();
