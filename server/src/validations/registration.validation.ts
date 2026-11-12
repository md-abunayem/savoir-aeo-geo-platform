import { z } from "zod";
const email = z.string().trim().toLowerCase().pipe(z.email().max(255));
const password = z
  .string()
  .min(1)
  .max(72)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password exceeds bcrypt input limit");
export const registrationSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    email,
    password: password.refine((value) => [...value].length >= 15, "Use at least 15 characters"),
  })
  .strict();
export const resendVerificationSchema = z.object({ email }).strict();
export const verificationSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password })
  .strict();
