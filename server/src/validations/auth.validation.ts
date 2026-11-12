import { z } from "zod";

export const loginSchema = z
  .object({
    email: z
      .email()
      .max(255)
      .transform((value) => value.trim().toLowerCase()),
    password: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= 72,
        "Password exceeds bcrypt input limit",
      ),
  })
  .strict();
