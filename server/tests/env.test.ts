import { describe, it, expect } from "vitest";
import { parseEnvironment } from "../src/config/env.js";

const base = {
  DATABASE_URL: "postgresql://user:secret@localhost/test",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "test-bucket",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("environment validation", () => {
  it("uses a Neon runtime URL without requiring migration credentials", () => {
    const { DATABASE_URL: _unused, ...runtimeOnly } = base;
    const env = parseEnvironment({
      ...runtimeOnly,
      DATABASE_APP_URL: "postgresql://app:secret@neon.example/test?sslmode=require",
      S3_ENDPOINT: "https://storage.example",
      S3_REGION: "eu-central-1",
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.S3_REGION).toBe("eu-central-1");
  });
  it("accepts arbitrary OpenRouter model IDs from environment configuration", () => {
    expect(() => parseEnvironment({ ...base, GEMINI_API_KEY: "sk-or-misplaced" })).toThrow(
      "GEMINI_API_KEY",
    );
    expect(
      parseEnvironment({
        ...base,
        OPENROUTER_API_KEY: "sk-or-fixture",
        OPENROUTER_MODEL: "  custom-provider/model:variant:reasoning  ",
      }).OPENROUTER_MODEL,
    ).toBe("custom-provider/model:variant:reasoning");
    for (const model of ["", "model with spaces", "\u0000model", "model\u007f", "x".repeat(257)]) {
      expect(() => parseEnvironment({ ...base, OPENROUTER_MODEL: model })).toThrow(
        "OPENROUTER_MODEL",
      );
    }
  });
  it("accepts explicit origins and defaults", () => {
    const env = parseEnvironment({
      ...base,
      CORS_ORIGIN: "http://localhost:3000,https://example.com",
    });
    expect(env.PORT).toBe(8000);
    expect(env.CORS_ORIGIN).toHaveLength(2);
  });
  it("rejects wildcard origins, paths, invalid ports and connection protocols", () => {
    for (const override of [
      { CORS_ORIGIN: "*" },
      { CORS_ORIGIN: "https://example.com/path" },
      { PORT: "-1" },
      { REDIS_URL: "https://example.com" },
    ]) {
      expect(() => parseEnvironment({ ...base, ...override })).toThrow(
        "Invalid environment fields:",
      );
    }
  });
  it("requires a separate runtime connection in production", () => {
    expect(() => parseEnvironment({ ...base, NODE_ENV: "production" })).toThrow("DATABASE_APP_URL");
  });
  it("does not leak invalid values", () => {
    expect(() => parseEnvironment({ ...base, DATABASE_URL: "secret-value" })).toThrow(
      "Invalid environment fields: DATABASE_URL",
    );
  });
  it("treats blank and placeholder provider keys as unconfigured", () => {
    for (const key of [
      "",
      "   ",
      "your_openai_api_key",
      "your-gemini-key",
      "placeholder",
      "<api-key>",
    ]) {
      const env = parseEnvironment({
        ...base,
        GEMINI_API_KEY: key,
        OPENAI_API_KEY: key,
        SERP_PROVIDER_API_KEY: key,
        FIRECRAWL_API_KEY: key,
      });
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.SERP_PROVIDER_API_KEY).toBeUndefined();
      expect(env.FIRECRAWL_API_KEY).toBeUndefined();
    }
  });
  it("normalizes provider keys and requires a usable provider for monitoring", () => {
    expect(
      parseEnvironment({ ...base, FIRECRAWL_API_KEY: "  fc-configured-key  " }).FIRECRAWL_API_KEY,
    ).toBe("fc-configured-key");
    expect(parseEnvironment({ ...base, GEMINI_API_KEY: "  configured-key  " }).GEMINI_API_KEY).toBe(
      "configured-key",
    );
    expect(() =>
      parseEnvironment({
        ...base,
        AUTH_ENABLED: "true",
        AUTH_JWT_SECRET: "a".repeat(48),
        AUTH_CSRF_SECRET: "b".repeat(48),
        DATABASE_APP_URL: base.DATABASE_URL,
        MONITORING_ENABLED: "true",
        OPENAI_API_KEY: "your_openai_api_key",
      }),
    ).toThrow("GEMINI_API_KEY");
  });
});

it("requires restricted access and independent signing configuration when authentication is enabled", () => {
  expect(() => parseEnvironment({ ...base, AUTH_ENABLED: "true" })).toThrow("DATABASE_APP_URL");
  expect(() =>
    parseEnvironment({
      ...base,
      AUTH_ENABLED: "true",
      DATABASE_APP_URL: base.DATABASE_URL,
      AUTH_JWT_SECRET: "short",
      AUTH_CSRF_SECRET: "short",
    }),
  ).toThrow("AUTH_JWT_SECRET");
});
