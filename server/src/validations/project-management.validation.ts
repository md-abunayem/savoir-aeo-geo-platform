import { z } from "zod";
import {
  brandProfileSchema,
  competitorInputSchema,
  promptInputSchema,
} from "./onboarding.validation.js";
import { monitoringEngine } from "./monitoring.validation.js";
export const marketsInput = z
  .array(
    z
      .object({
        country: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/),
        language: z
          .string()
          .trim()
          .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
      })
      .strict(),
  )
  .min(1)
  .max(10)
  .refine(
    (rows) => new Set(rows.map((r) => `${r.country}:${r.language}`)).size === rows.length,
    "Duplicate markets",
  );
export const createProjectInput = z
  .object({
    domain: z.string().trim().min(3).max(255),
    brandName: brandProfileSchema.shape.brandName,
    description: brandProfileSchema.shape.description,
    aliases: brandProfileSchema.shape.aliases,
    region: z.enum(["us", "eu"]).default("us"),
    markets: marketsInput,
    competitors: z.array(competitorInputSchema).max(25).default([]),
    prompts: z.array(promptInputSchema).max(100).default([]),
  })
  .strict();
export const updateProjectInput = z
  .object({
    brandName: brandProfileSchema.shape.brandName,
    description: brandProfileSchema.shape.description,
    aliases: brandProfileSchema.shape.aliases,
    markets: marketsInput,
    competitors: z.array(competitorInputSchema.extend({ id: z.uuid().optional() })).max(25),
    prompts: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            body: z.string().trim().min(3).max(500),
            active: z.boolean().default(true),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const launchProjectInput = z
  .object({
    mode: z.enum(["once", "schedule"]),
    engines: z
      .array(monitoringEngine)
      .max(5)
      .refine((v) => new Set(v).size === v.length),
    cadence: z.enum(["daily", "weekly"]).default("daily"),
    samples: z.number().int().min(1).max(5).default(1),
    crawl: z.boolean().default(false),
    pagesLimit: z.number().int().min(1).max(10).default(1),
  })
  .strict()
  .refine((v) => v.crawl || v.engines.length > 0, "Select crawling or at least one AI engine")
  .refine(
    (v) => v.mode !== "schedule" || v.engines.length > 0,
    "Select an AI engine to schedule monitoring; website crawls run once",
  );
export const projectRequestKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
