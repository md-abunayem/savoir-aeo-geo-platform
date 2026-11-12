import { z } from "zod";

export const triggerAuditSchema = z.object({
  body: z.object({
    crawlType: z.enum(["single_page", "key_pages", "full_site"]).optional().default("full_site"),
    pagesLimit: z.coerce.number().int().min(1).max(500).optional().default(500),
    targetDomain: z.string().trim().max(255).optional(),
  }),
});

export const listAuditPagesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(1000).optional().default(20),
    indexableOnly: z
      .string()
      .optional()
      .transform((val) => val === "true"),
    search: z.string().trim().optional(),
  }),
});

export const listAuditIssuesSchema = z.object({
  query: z.object({
    category: z.string().trim().optional(),
    severity: z.string().trim().optional(),
    findingType: z.enum(["problem", "suggestion", "information"]).optional(),
    search: z.string().trim().optional(),
  }),
});

export const exportAuditSchema = z.object({
  query: z.object({
    type: z.enum(["pages", "issues"]).optional().default("issues"),
    findingType: z.enum(["problem", "suggestion", "information"]).optional(),
    category: z.string().trim().optional(),
    severity: z.string().trim().optional(),
    search: z.string().trim().optional(),
  }),
});

export const auditScheduleSchema = z.object({
  body: z.object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
  }),
});

export const updateAuditIssueSchema = z.object({
  body: z.object({
    status: z.enum(["open", "fixed", "dismissed"]),
  }),
});

export type TriggerAuditInput = z.infer<typeof triggerAuditSchema>["body"];
