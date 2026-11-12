import { z } from "zod";

export const competitorInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  domain: z.string().trim().min(3).max(255),
});

export const submitGraderSchema = z.object({
  body: z.object({
    brandName: z.string().trim().min(1, "Brand name is required").max(100),
    domain: z.string().trim().min(3, "Domain is required").max(255),
    category: z.string().trim().max(100).optional(),
    country: z.string().trim().min(2).max(10).default("US"),
    competitors: z.array(competitorInputSchema).max(3).optional().default([]),
    turnstileToken: z.string().trim().optional(),
    deviceFingerprint: z.string().trim().max(100).optional(),
    forceRefresh: z.boolean().optional().default(false),
  }),
});

export const emailGraderReportSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Please provide a valid email address"),
    consent: z.boolean().refine((val) => val === true, {
      message: "Explicit consent is required to receive the report and email updates",
    }),
  }),
});

export type SubmitGraderInput = z.input<typeof submitGraderSchema>["body"];
export type EmailGraderReportInput = z.infer<typeof emailGraderReportSchema>["body"];
