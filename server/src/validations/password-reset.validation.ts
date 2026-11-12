import { z } from "zod";
import { registrationSchema, resendVerificationSchema } from "./registration.validation.js";
export const forgotPasswordSchema = resendVerificationSchema;
export const resetPasswordSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    password: registrationSchema.shape.password,
  })
  .strict();
