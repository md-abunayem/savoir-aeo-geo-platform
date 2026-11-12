import { z } from "zod";
const unique = (items: string[]) => new Set(items).size === items.length;
export const monitoringEngine = z.enum([
  "openrouter",
  "gemini",
  "openai",
  "google_ai_overviews",
  "google_ai_mode",
]);
export const promptInput = z
  .object({
    body: z.string().trim().min(1).max(4000),
    persona: z.string().trim().max(1000).default(""),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  })
  .strict();
export const promptPatch = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    persona: z.string().trim().max(1000).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const promptImportInput = z
  .object({ prompts: z.array(promptInput).min(1).max(100) })
  .strict();
export const promptBulkInput = z
  .object({
    promptIds: z.array(z.uuid()).min(1).max(100).refine(unique),
    action: z.enum(["pause", "resume", "archive", "restore", "add-tag"]),
    tag: z.string().trim().min(1).max(30).optional(),
  })
  .strict()
  .refine((value) => (value.action === "add-tag") === (value.tag !== undefined));
export const promptListInput = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    before: z.uuid().optional(),
    includeArchived: z.enum(["true", "false"]).default("false"),
  })
  .strict();
export const runInput = z
  .object({
    engine: monitoringEngine.default("gemini"),
    promptIds: z.array(z.uuid()).min(1).max(100).refine(unique),
    geos: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(10)
      .refine(unique)
      .default(["US"]),
    languages: z
      .array(z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/))
      .min(1)
      .max(10)
      .refine(unique)
      .default(["en"]),
    samples: z.number().int().min(1).max(5).default(3),
  })
  .strict();
export const scheduleInput = runInput
  .extend({
    samples: z.number().int().min(1).max(5).default(1),
    cadence: z.enum(["daily", "weekly", "custom"]).default("daily"),
    intervalMinutes: z.number().int().min(60).max(43200).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.cadence === "custom" && v.intervalMinutes === undefined)
      c.addIssue({
        code: "custom",
        path: ["intervalMinutes"],
        message: "Custom interval required",
      });
    if (v.cadence !== "custom" && v.intervalMinutes !== undefined)
      c.addIssue({
        code: "custom",
        path: ["intervalMinutes"],
        message: "Use custom cadence for an explicit interval",
      });
  });
export const scheduleStatus = z
  .object({ status: z.enum(["active", "paused", "deleted"]) })
  .strict();
export const listRunsInput = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    before: z.uuid().optional(),
  })
  .strict();
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
export const projectParams = z.object({ tenantId: z.uuid(), projectId: z.uuid() });
export function boundBatch(v: z.infer<typeof runInput>) {
  if (v.promptIds.length * v.geos.length * v.languages.length * v.samples > 500)
    throw new Error("MONITORING_BATCH_TOO_LARGE");
}
