import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { createBrevoProvider } from "../src/services/email/brevo.adapter.js";
import { createPayloadCipher } from "../src/services/email/crypto.js";

const config = {
  apiKey: "test-key-not-real",
  senderEmail: "sender@test.invalid",
  senderName: "Savoir Test",
};
const message = {
  to: "recipient@test.invalid",
  subject: "Verify your account",
  text: "Hello <script>unsafe</script>\nhttps://example.invalid/verify#token=test",
};

describe("Brevo contract without external delivery", () => {
  it("uses the official endpoint, stable idempotency key, escaped HTML and provider acceptance ID", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ messageId: "<accepted@test.invalid>" }), { status: 201 }),
      );
    const provider = createBrevoProvider(config, transport);
    const id = randomUUID();
    expect(await provider.send(message, id)).toEqual({
      messageId: "<accepted@test.invalid>",
      deduplicated: false,
    });
    const [url, request] = transport.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(request?.headers).toMatchObject({ "api-key": config.apiKey });
    const body = JSON.parse(request?.body as string);
    expect(body.headers.idempotencyKey).toBe(id);
    expect(body.htmlContent).not.toContain("<script>");
    expect(body.htmlContent).toContain("&lt;script&gt;");
    expect(body.to).toEqual([{ email: message.to }]);
  });
  it("honors throttling, sanitizes errors and recognizes idempotency duplicates", async () => {
    const cases = [
      {
        response: new Response(JSON.stringify({ message: "private details" }), {
          status: 429,
          headers: { "Retry-After": "45" },
        }),
        expected: { code: "RATE_LIMITED", retryable: true, retryAfter: 45 },
      },
      {
        response: new Response("bad gateway", { status: 502 }),
        expected: { code: "HTTP_502", retryable: true },
      },
      {
        response: new Response(JSON.stringify({ message: "sender not verified" }), { status: 400 }),
        expected: { code: "HTTP_400", retryable: false },
      },
      {
        response: new Response("{}", { status: 201 }),
        expected: { code: "MALFORMED_RESPONSE", retryable: true },
      },
    ];
    for (const item of cases) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(item.response);
      await expect(
        createBrevoProvider(config, transport).send(message, randomUUID()),
      ).rejects.toMatchObject(item.expected);
    }
    const duplicate = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "duplicate_parameter",
          message: "Email for the idempotency key has already been processed",
        }),
        { status: 400 },
      ),
    );
    expect(await createBrevoProvider(config, duplicate).send(message, randomUUID())).toEqual({
      messageId: null,
      deduplicated: true,
    });
  });
  it("maps network failures to retryable sanitized errors", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("sensitive provider details"));
    await expect(
      createBrevoProvider(config, transport).send(message, randomUUID()),
    ).rejects.toMatchObject({
      code: "NETWORK",
      retryable: true,
      message: "Transactional email provider error",
    });
  });
});

describe("encrypted email payloads", () => {
  it("round trips without plaintext tokens and detects tampering", () => {
    const cipher = createPayloadCipher("a".repeat(64));
    const encrypted = cipher.encrypt(message);
    expect(encrypted).not.toContain(message.to);
    expect(encrypted).not.toContain("token=test");
    expect(cipher.decrypt(encrypted)).toEqual(message);
    const parts = encrypted.split(".");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 1;
    parts[3] = bytes.toString("base64url");
    expect(() => cipher.decrypt(parts.join("."))).toThrow();
    expect(() => createPayloadCipher("b".repeat(64)).decrypt(encrypted)).toThrow();
  });
});
