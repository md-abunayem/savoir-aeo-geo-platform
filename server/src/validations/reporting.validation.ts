import { z } from "zod";

export const createScheduleSchema = z.object({
  name: z.string().min(2).max(255),
  frequency: z.enum(["weekly", "monthly"]),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  recipients: z.array(z.string().email()).min(1),
  format: z.enum(["pdf", "html", "csv"]).default("pdf"),
  sections: z
    .array(
      z.enum([
        "visibility",
        "citations",
        "competitors",
        "technical",
        "content",
        "traffic",
        "actions",
      ]),
    )
    .optional(),
});

export const generateReportSchema = z.object({
  title: z.string().max(255).optional(),
  dateWindowDays: z.coerce
    .number()
    .int()
    .refine((n) => [7, 14, 30, 90].includes(n), {
      message: "dateWindowDays must be 7, 14, 30, or 90",
    })
    .default(30),
  format: z.enum(["pdf", "html", "json"]).default("pdf"),
  recipients: z.array(z.string().email()).optional(),
});

export const createAlertRuleSchema = z.object({
  name: z.string().min(2).max(255),
  ruleType: z.enum(["visibility_drop", "competitor_overtake", "lost_citation", "crawl_blockage"]),
  threshold: z.record(z.string(), z.any()),
  severity: z.enum(["critical", "warning", "info"]).default("warning"),
  channels: z.array(z.enum(["in_app", "email", "webhook"])).default(["in_app", "email"]),
  emailRecipients: z.array(z.string().email()).optional(),
  cooldownHours: z.number().int().min(1).max(168).default(24),
});

export const updateIncidentSchema = z.object({
  status: z.enum(["acknowledged", "resolved", "dismissed"]),
  notes: z.string().max(2000).optional(),
});

export const dashboardQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((n) => [7, 14, 30, 90].includes(n), {
      message: "days must be 7, 14, 30, or 90",
    })
    .default(30),
});

export const incidentsQuerySchema = z.object({
  status: z.enum(["active", "acknowledged", "resolved", "dismissed"]).optional(),
  severity: z.enum(["critical", "warning", "info"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
