import { z } from "zod";

export const listInventorySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    isStale: z
      .string()
      .optional()
      .transform((val) => (val === "true" ? true : val === "false" ? false : undefined)),
    search: z.string().trim().optional(),
  }),
});

export const listGapsSchema = z.object({
  query: z.object({
    status: z.enum(["open", "in_brief", "resolved", "dismissed"]).optional(),
    minPriority: z.coerce.number().min(0).max(100).optional(),
  }),
});

export const comparePageSchema = z.object({
  body: z.object({
    ownedUrl: z.string().url(),
    competitorUrl: z.string().url(),
  }),
});

export const createBriefSchema = z.object({
  body: z.object({
    gapId: z.string().uuid().optional(),
    targetPrompts: z.array(z.string().min(1)).min(1),
    primaryIntent: z
      .enum(["informational", "commercial", "comparison", "troubleshooting"])
      .optional(),
    title: z.string().trim().min(1).max(500).optional(),
  }),
});

export const updateBriefSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(500).optional(),
    markdownContent: z.string().optional(),
    status: z.enum(["draft", "in_review", "ready", "exported"]).optional(),
  }),
});

export const exportBriefSchema = z.object({
  query: z.object({
    format: z.enum(["markdown", "docx"]).optional().default("markdown"),
  }),
});

export type ListInventoryInput = z.infer<typeof listInventorySchema>["query"];
export type ListGapsInput = z.infer<typeof listGapsSchema>["query"];
export type ComparePageInput = z.infer<typeof comparePageSchema>["body"];
export type CreateBriefInput = z.infer<typeof createBriefSchema>["body"];
export type UpdateBriefInput = z.infer<typeof updateBriefSchema>["body"];
export type ExportBriefInput = z.infer<typeof exportBriefSchema>["query"];
