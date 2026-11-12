import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type { Pool, PoolClient } from "pg";
import { createEmailOutbox } from "./email/outbox.service.js";
import { createPayloadCipher } from "./email/crypto.js";
import type { PasswordSafetyCheck } from "./password-safety.service.js";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validations/password-reset.validation.js";
import { ApiError } from "../utils/ApiError.js";
export interface PasswordResetService {
  request(email: string): Promise<void>;
  reset(token: string, password: string): Promise<void>;
}
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const invalid = () => new ApiError(400, "Reset code is invalid or expired", "INVALID_RESET_TOKEN");
export async function createPasswordResetService(
  pool: Pool,
  encryptionKey: string,
  checkPassword: PasswordSafetyCheck,
): Promise<PasswordResetService> {
  createPayloadCipher(encryptionKey);
  const role = await pool.query(
    "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
  );
  if (!role.rows[0] || Object.values(role.rows[0]).some(Boolean))
    throw new Error("Password reset requires a restricted runtime database role");
  async function transaction(work: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await work(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return {
    async request(email) {
      const data = forgotPasswordSchema.parse({ email });
      const token = randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 30 * 60 * 1000);
      await transaction(async (client) => {
        const result = await client.query<{ id: string | null }>(
          "SELECT public.savoir_password_reset_issue($1,$2,$3) AS id",
          [data.email, hash(token), expires],
        );
        const id = result.rows[0]?.id;
        if (!id) return;
        await createEmailOutbox(client, encryptionKey).enqueue(
          randomUUID(),
          id,
          {
            to: data.email,
            subject: "Reset your Savoir password",
            text:
              "Your Savoir password reset code is:\n\n" +
              token +
              "\n\nThis code expires in 30 minutes and works once. If you did not request a reset, ignore this email. Your password has not changed.",
          },
          expires,
        );
      });
    },
    async reset(token, password) {
      const data = resetPasswordSchema.parse({ token, password });
      const tokenHash = hash(data.token);
      const valid = await pool.query<{ valid: boolean }>(
        "SELECT public.savoir_password_reset_valid($1) AS valid",
        [tokenHash],
      );
      if (!valid.rows[0]?.valid) throw invalid();
      await checkPassword(data.password);
      const passwordHash = await bcrypt.hash(data.password, 12);
      await transaction(async (client) => {
        const result = await client.query<{ id: string; email: string }>(
          "SELECT * FROM public.savoir_password_reset_consume($1,$2)",
          [tokenHash, passwordHash],
        );
        const user = result.rows[0];
        if (!user) throw invalid();
        await createEmailOutbox(client, encryptionKey).enqueue(
          randomUUID(),
          user.id,
          {
            to: user.email,
            subject: "Your Savoir password was changed",
            text: "Your Savoir password was reset and all previous sessions were signed out. If you did not make this change, request another password reset immediately.",
          },
          new Date(Date.now() + 23 * 60 * 60 * 1000),
        );
      });
    },
  };
}
