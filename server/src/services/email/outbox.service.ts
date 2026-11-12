import type { Pool } from "pg";
import { z } from "zod";
import { createPayloadCipher } from "./crypto.js";
import {
  emailMessageSchema,
  EmailDeliveryError,
  type EmailProvider,
  type EmailMessage,
} from "./brevo.adapter.js";

interface ClaimedEmail {
  id: string;
  encrypted_payload: string;
  lease_id: string;
  attempts: number;
}
export function createEmailOutbox(pool: Pick<Pool, "query">, encryptionKey: string) {
  const cipher = createPayloadCipher(encryptionKey);
  return {
    async enqueue(id: string, userId: string, message: EmailMessage, expiresAt: Date) {
      z.uuid().parse(id);
      z.uuid().parse(userId);
      const payload = cipher.encrypt(emailMessageSchema.parse(message));
      await pool.query("SELECT public.savoir_email_enqueue($1,$2,$3,$4)", [
        id,
        userId,
        payload,
        expiresAt,
      ]);
      return id;
    },
    async processNext(provider: EmailProvider): Promise<boolean> {
      const claimed = await pool.query<ClaimedEmail>("SELECT * FROM public.savoir_email_claim()");
      const email = claimed.rows[0];
      if (!email) return false;
      let status: "accepted" | "pending" | "failed" = "accepted";
      let messageId: string | null = null;
      let code: string | null;
      let delay = 0;
      try {
        const result = await provider.send(
          emailMessageSchema.parse(cipher.decrypt(email.encrypted_payload)),
          email.id,
        );
        messageId = result.messageId;
        code = result.deduplicated ? "PROVIDER_DEDUPLICATED" : null;
      } catch (error) {
        status =
          error instanceof EmailDeliveryError && error.retryable && email.attempts < 5
            ? "pending"
            : "failed";
        code = error instanceof EmailDeliveryError ? error.code : "INVALID_PAYLOAD";
        delay =
          error instanceof EmailDeliveryError
            ? Math.min(86400, Math.max(error.retryAfter, 10 * 2 ** (email.attempts - 1)))
            : 0;
      }
      // A lost completion write is recovered with the same provider key, never a new email ID.
      await pool.query("SELECT public.savoir_email_complete($1,$2,$3,$4,$5,$6)", [
        email.id,
        email.lease_id,
        status,
        messageId,
        code,
        delay,
      ]);
      return true;
    },
  };
}
