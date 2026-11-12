import { describe, it, expect } from "vitest";
import { webhookUrl } from "../src/services/integrations/webhook-delivery.js";

describe("Webhook URL boundary", () => {
  it.each([
    "http://example.com/hook",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://localhost/hook",
    "https://test.localhost/hook",
    "https://user:secret@example.com/",
    "https://example.com:8080/",
  ])("rejects unsafe destination %s", (url) => {
    expect(() => webhookUrl(url)).toThrow("public HTTPS hostname");
  });
  it("preserves a public HTTPS destination path and query", () => {
    expect(webhookUrl("https://example.com/hook?event=ping").href).toBe(
      "https://example.com/hook?event=ping",
    );
  });
});
