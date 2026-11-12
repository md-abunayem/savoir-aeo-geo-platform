import { z } from "zod";

export const connectProviderSchema = z.object({
  provider: z.enum(["google_search_console", "google_analytics_4", "slack", "hubspot"]),
  accountEmail: z.string().email().optional(),
  propertyId: z.string().trim().min(1).max(255).optional(),
  propertyName: z.string().optional(),
  scopesGranted: z.array(z.string()).optional(),
  tokens: z
    .object({
      access_token: z.string().trim().min(1).max(8192),
      refresh_token: z.string().trim().min(1).max(8192).optional(),
      expires_at: z.number().positive().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const disconnectProviderSchema = z.object({
  purgeData: z.boolean().optional(),
});

export const createApiKeySchema = z.object({
  name: z.string().min(2).max(255),
  scopes: z
    .array(z.enum(["read", "read:traffic", "read:actions"]))
    .min(1)
    .max(3)
    .optional(),
  rateLimitRpm: z.number().int().min(10).max(1000).optional(),
});

export const createWebhookSchema = z.object({
  url: z.string().url("Valid HTTP or HTTPS URL required"),
  events: z.array(z.string()).min(1, "At least one event subscription required"),
  description: z.string().max(255).optional(),
});

export const trafficOverviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const gscQuerySchema = z.object({
  questionOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
