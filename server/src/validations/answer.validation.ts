import { z } from "zod";

export const listAnswersQuerySchema = z.object({
  engine: z.string().optional(),
  promptId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  geo: z.string().max(10).optional(),
  language: z.string().max(10).optional(),
  brandMentioned: z.enum(["true", "false"]).optional(),
  competitorId: z.string().uuid().optional(),
  sentiment: z.enum(["-1", "0", "1"]).optional(),
  citationDomain: z.string().trim().max(100).optional(),
  status: z.string().max(24).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  format: z.enum(["json", "csv"]).default("json"),
});

export const compareAnswersQuerySchema = z.object({
  promptId: z.string().uuid().optional(),
  answerId1: z.string().uuid().optional(),
  answerId2: z.string().uuid().optional(),
});

export const flagAnswerInputSchema = z.object({
  reason: z.string().trim().min(1).max(80),
  note: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().max(30)).max(10).default([]),
});

export const reviewMentionInputSchema = z.object({
  reviewStatus: z.enum(["verified", "false_positive"]),
});
