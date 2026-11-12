import { describe, expect, it } from "vitest";
import { apiOrigin } from "../lib/api-origin";

describe("API origin configuration", () => {
  it("keeps the local backend default for ordinary Next.js builds", () => {
    expect(apiOrigin(undefined)).toBe("http://127.0.0.1:8000");
  });
  it("uses the configured backend origin", () => {
    expect(apiOrigin("https://api.example.com/", true)).toBe("https://api.example.com");
  });
  it.each([undefined, "http://api.example.com", "https://localhost", "https://localhost.", "https://dev.localhost", "https://127.0.0.1:8000", "https://127.1", "https://[::1]", "https://0.0.0.0"])("rejects an unusable Cloudflare backend: %s", (value) => {
    expect(() => apiOrigin(value, true)).toThrow("public HTTPS backend origin");
  });
  it.each(["https://user:pass@api.example.com", "https://api.example.com/v1", "https://api.example.com?x=1", "https://api.example.com#x", "ftp://api.example.com"])("rejects an invalid origin: %s", (value) => {
    expect(() => apiOrigin(value)).toThrow("without credentials or a path");
  });
});
