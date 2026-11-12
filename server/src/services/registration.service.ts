import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type { Pool, PoolClient } from "pg";
import { createEmailOutbox } from "./email/outbox.service.js";
import { createPayloadCipher } from "./email/crypto.js";
import type { PasswordSafetyCheck } from "./password-safety.service.js";
import { ApiError } from "../utils/ApiError.js";
import {
  registrationSchema,
  verificationSchema,
  resendVerificationSchema,
} from "../validations/registration.validation.js";

export interface RegistrationService {
  register(input: { name: string; email: string; password: string }): Promise<void>;
  resend(email: string): Promise<void>;
  verify(token: string, password: string): Promise<void>;
}
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const invalid = () =>
  new ApiError(400, "Verification code or password is invalid or expired", "INVALID_VERIFICATION");

export async function createRegistrationService(
  pool: Pool,
  encryptionKey: string,
  checkPassword: PasswordSafetyCheck,
  options?: { requireEmailVerification?: boolean },
): Promise<RegistrationService> {
  createPayloadCipher(encryptionKey);
  const role = await pool.query(
    "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
  );
  if (!role.rows[0] || Object.values(role.rows[0]).some(Boolean))
    throw new Error("Registration requires a restricted runtime database role");
  const dummyHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
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
  async function issue(client: PoolClient, email: string) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const result = await client.query<{ id: string | null }>(
      "SELECT public.savoir_verification_issue($1,$2,$3) AS id",
      [email, hash(token), expiresAt],
    );
    const id = result.rows[0]?.id;
    if (!id) return;
    await createEmailOutbox(client, encryptionKey).enqueue(
      randomUUID(),
      id,
      {
        to: email,
        subject: "Verify your Savoir email",
        text:
          "Your Savoir verification code is:\n\n" +
          token +
          "\n\nThis code expires in 30 minutes and works once. Submit it with the password you chose when registering. If you did not request this, ignore this email.",
      },
      expiresAt,
    );
  }
  return {
    async register(input) {
      const data = registrationSchema.parse(input);
      await checkPassword(data.password);
      // Hash before checking account existence, including duplicate requests.
      const passwordHash = await bcrypt.hash(data.password, 12);
      const requireVerification = options?.requireEmailVerification ?? true;
      await transaction(async (client) => {
        const result = await client.query<{ id: string | null }>(
          "SELECT public.savoir_register($1,$2,$3,$4) AS id",
          [data.name, data.email, passwordHash, !requireVerification],
        );
        if (result.rows[0]?.id && requireVerification) await issue(client, data.email);
      });
    },
    async resend(email) {
      const data = resendVerificationSchema.parse({ email });
      await transaction((client) => issue(client, data.email));
    },
    async verify(token, password) {
      const data = verificationSchema.parse({ token, password });
      const tokenHash = hash(data.token);
      const result = await pool.query<{ password_hash: string }>(
        "SELECT * FROM public.savoir_verification_find($1)",
        [tokenHash],
      );
      const passwordHash = result.rows[0]?.password_hash;
      const matches = await bcrypt.compare(data.password, passwordHash ?? dummyHash);
      if (!matches || !passwordHash) throw invalid();
      const consumed = await pool.query<{ verified: boolean }>(
        "SELECT public.savoir_verification_consume($1,$2) AS verified",
        [tokenHash, passwordHash],
      );
      if (!consumed.rows[0]?.verified) throw invalid();
    },
  };
}
