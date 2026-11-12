import { z } from "zod";

export const brandProfileSchema = z
  .object({
    brandName: z.string().trim().min(1).max(150),
    aliases: z.array(z.string().trim().min(1).max(100)).max(25).default([]),
    description: z.string().trim().max(1000).default(""),
    category: z.string().trim().min(1).max(100).default("General"),
    products: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    primaryLanguage: z.string().trim().min(2).max(10).default("en"),
  })
  .strict();

export const competitorInputSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    domain: z.string().trim().min(3).max(255),
    rationale: z.string().trim().max(500).optional(),
    aliases: z.array(z.string().trim().min(1).max(100)).max(25).default([]),
  })
  .strict();

export const marketInputSchema = z
  .object({
    country: z.string().trim().min(2).max(10).default("US"),
    language: z.string().trim().min(2).max(10).default("en"),
  })
  .strict();

export const promptInputSchema = z
  .object({
    text: z.string().trim().min(3).max(500),
    intent: z
      .enum(["informational", "comparison", "transactional", "navigational"])
      .default("informational"),
    funnelStage: z.enum(["awareness", "consideration", "decision"]).default("awareness"),
    priority: z.number().int().min(1).max(5).default(1),
    tags: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
    persona: z.string().trim().max(200).default(""),
  })
  .strict();

export const analyzeDomainSchema = z
  .object({
    domain: z.string().trim().min(3).max(255),
    brandName: z.string().trim().min(1).max(150).optional(),
  })
  .strict();

export const generateSeedsSchema = z
  .object({
    domain: z.string().trim().min(3).max(255),
    brandProfile: brandProfileSchema,
    market: marketInputSchema.optional(),
  })
  .strict();

export const estimateCostsSchema = z
  .object({
    promptCount: z.number().int().min(1).max(500),
    engines: z.array(z.string().trim().min(1).max(50)).min(1).max(10),
  })
  .strict();

export const saveDraftSchema = z
  .object({
    step: z.number().int().min(1).max(6),
    data: z.record(z.string(), z.any()),
  })
  .strict();

export const activateProjectSchema = z
  .object({
    domain: z.string().trim().min(3).max(255),
    brandName: z.string().trim().min(1).max(150),
    description: z.string().trim().max(1000).optional().default(""),
    aliases: z.array(z.string().trim().min(1).max(100)).max(25).default([]),
    category: z.string().trim().max(100).optional().default("General"),
    region: z.enum(["us", "eu"]).default("us"),
    competitors: z.array(competitorInputSchema).min(1).max(25),
    markets: z
      .array(marketInputSchema)
      .min(1)
      .max(10)
      .default([{ country: "US", language: "en" }]),
    prompts: z.array(promptInputSchema).min(1).max(100),
    engines: z
      .array(z.string().trim().min(1).max(50))
      .min(1)
      .max(10)
      .default(["chatgpt", "gemini"]),
  })
  .strict();

export type BrandProfile = z.infer<typeof brandProfileSchema>;
export type CompetitorInput = z.infer<typeof competitorInputSchema>;
export type MarketInput = z.infer<typeof marketInputSchema>;
export type PromptInput = z.infer<typeof promptInputSchema>;
export type ActivateProjectInput = z.infer<typeof activateProjectSchema>;
