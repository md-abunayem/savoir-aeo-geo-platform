import { z } from "zod";

export const actionParamsSchema = z.object({
  tenantId: z.string().uuid("Invalid tenant ID"),
  projectId: z.string().uuid("Invalid project ID"),
});

export const actionDetailParamsSchema = z.object({
  tenantId: z.string().uuid("Invalid tenant ID"),
  projectId: z.string().uuid("Invalid project ID"),
  actionId: z.string().uuid("Invalid action ID"),
});

export const listActionsQuerySchema = z.object({
  category: z
    .enum(["technical", "content", "citation", "agent_readiness", "accuracy", "competitor"])
    .optional(),
  sourceModule: z.enum(["M5", "M6", "M7", "M8", "M9", "M16", "manual"]).optional(),
  status: z.enum(["backlog", "todo", "in_progress", "done", "dismissed"]).optional(),
  effort: z.enum(["S", "M", "L"]).optional(),
  owner: z.string().optional(),
  search: z.string().optional(),
  minPriority: z.coerce.number().min(0).max(100).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  sortBy: z.enum(["priority", "dueDate", "created"]).default("priority"),
});

export const createActionBodySchema = z.object({
  title: z.string().min(3).max(500),
  description: z.string().min(5),
  category: z.enum([
    "technical",
    "content",
    "citation",
    "agent_readiness",
    "accuracy",
    "competitor",
  ]),
  impact: z.number().int().min(1).max(10).optional(),
  confidence: z.number().min(0).max(1).optional(),
  effort: z.enum(["S", "M", "L"]).optional(),
  owner: z.string().max(255).optional(),
  dueDate: z.string().datetime().optional(),
  evidence: z.array(z.record(z.string(), z.any())).optional(),
  fixGuidance: z.record(z.string(), z.any()).optional(),
});

export const updateActionBodySchema = z.object({
  status: z.enum(["backlog", "todo", "in_progress", "done", "dismissed"]).optional(),
  dismissReason: z.string().max(1000).optional(),
  owner: z.string().max(255).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  impact: z.number().int().min(1).max(10).optional(),
  confidence: z.number().min(0).max(1).optional(),
  effort: z.enum(["S", "M", "L"]).optional(),
});

export const bulkUpdateActionsBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  status: z.enum(["backlog", "todo", "in_progress", "done", "dismissed"]).optional(),
  dismissReason: z.string().max(1000).optional(),
  owner: z.string().max(255).optional(),
});

export const addCommentBodySchema = z.object({
  body: z.string().min(1).max(5000),
});
