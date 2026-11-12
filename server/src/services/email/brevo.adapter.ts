import { z } from "zod";

export const emailMessageSchema = z
  .object({
    to: z.email().max(255),
    subject: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\r\n]+$/),
    text: z.string().min(1).max(100000),
  })
  .strict();
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export interface EmailProvider {
  send(
    message: EmailMessage,
    idempotencyKey: string,
  ): Promise<{ messageId: string | null; deduplicated: boolean }>;
}
export class EmailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfter = 10,
    options?: ErrorOptions,
  ) {
    super("Transactional email provider error", options);
  }
}
const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function createBrevoProvider(
  config: { apiKey: string; senderEmail: string; senderName: string },
  transport: typeof fetch = fetch,
): EmailProvider {
  z.object({
    apiKey: z.string().min(1),
    senderEmail: z.email(),
    senderName: z.string().min(1).max(100),
  }).parse(config);
  return {
    async send(input, idempotencyKey) {
      const message = emailMessageSchema.parse(input);
      z.uuid().parse(idempotencyKey);
      let response: Response;
      try {
        response = await transport("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": config.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            sender: { email: config.senderEmail, name: config.senderName },
            to: [{ email: message.to }],
            subject: message.subject,
            textContent: message.text,
            htmlContent:
              "<html><body><p>" +
              escapeHtml(message.text).replaceAll("\n", "<br>") +
              "</p></body></html>",
            headers: { idempotencyKey },
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        throw new EmailDeliveryError("NETWORK", true, 10, { cause: error });
      }
      const body: unknown = await response.json().catch(() => null);
      const record =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      if (response.status === 201 && typeof record.messageId === "string")
        return { messageId: record.messageId, deduplicated: false };
      if (
        response.status === 400 &&
        record.code === "duplicate_parameter" &&
        typeof record.message === "string" &&
        /idempotenc/i.test(record.message)
      )
        return { messageId: null, deduplicated: true };
      const retryHeader = response.headers.get("Retry-After");
      const numeric = Number(retryHeader);
      const retryAfter = retryHeader
        ? Math.max(
            1,
            Number.isFinite(numeric)
              ? numeric
              : Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000),
          )
        : 10;
      const retryable = response.status === 429 || response.status >= 500 || response.ok;
      throw new EmailDeliveryError(
        response.status === 429
          ? "RATE_LIMITED"
          : response.ok
            ? "MALFORMED_RESPONSE"
            : "HTTP_" + response.status,
        retryable,
        Number.isFinite(retryAfter) ? retryAfter : 10,
      );
    },
  };
}
