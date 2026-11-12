import { z } from "zod";

export const validateLlmsSchema = z.object({
  body: z.object({
    targetUrl: z.string().url().optional(),
  }),
});

export const generateRobotsSchema = z.object({
  body: z.object({
    preset: z
      .enum(["search_only", "maximum_visibility", "strict_copyright", "custom"])
      .optional()
      .default("search_only"),
    customBotRules: z.record(z.string(), z.boolean()).optional().default({}),
    customDirectives: z.string().optional(),
  }),
});

export const savePolicySchema = z.object({
  body: z.object({
    policyPreset: z
      .enum(["search_only", "maximum_visibility", "strict_copyright", "custom"])
      .optional()
      .default("search_only"),
    robotsTxtContent: z.string(),
    botRules: z.record(z.string(), z.boolean()).optional().default({}),
    trainingBotsDisallowed: z.boolean().optional().default(true),
    searchBotsAllowed: z.boolean().optional().default(true),
    customDirectives: z.string().nullable().optional(),
    llmsTxtDraft: z.string().nullable().optional(),
    llmsFullTxtDraft: z.string().nullable().optional(),
    llmsValidation: z.record(z.string(), z.unknown()).optional().default({}),
    schemaTemplates: z.record(z.string(), z.unknown()).optional().default({}),
  }),
});

export type ValidateLlmsInput = z.infer<typeof validateLlmsSchema>["body"];
export type GenerateRobotsInput = z.infer<typeof generateRobotsSchema>["body"];
export type SavePolicyInput = z.infer<typeof savePolicySchema>["body"];
