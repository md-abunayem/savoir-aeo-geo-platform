import { z } from "zod";

export const visibilityQuerySchema = z
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
    market: z.string().max(20).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .strict();

export const savedViewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    filters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const metricGoalInputSchema = z
  .object({
    metricName: z.enum([
      "composite_score",
      "visibility_rate",
      "share_of_voice",
      "position_score",
      "sentiment_score",
      "citation_rate",
      "recommended_rate",
    ]),
    targetValue: z.number().min(0).max(100),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "deadline must be YYYY-MM-DD")
      .optional()
      .nullable(),
    status: z.enum(["active", "achieved", "paused"]).default("active"),
  })
  .strict();

export type VisibilityQueryInput = z.infer<typeof visibilityQuerySchema>;
export type SavedViewRequestBody = z.infer<typeof savedViewInputSchema>;
export type MetricGoalRequestBody = z.infer<typeof metricGoalInputSchema>;
