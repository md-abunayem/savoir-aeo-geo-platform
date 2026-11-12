import { expect, it, vi } from "vitest";
import { createGeminiProvider } from "../src/services/monitoring/gemini.adapter.js";
import { createOpenRouterProvider } from "../src/services/monitoring/openrouter.adapter.js";
import { createMultiEngineProvider } from "../src/services/monitoring/multi-engine.provider.js";
import { checkGeminiCredential } from "../src/services/monitoring/gemini-auth.js";
import type { MonitoringRequest } from "../src/services/monitoring/types.js";
const request: MonitoringRequest = {
  engine: "openrouter",
  model: "vendor/selected:free",
  promptId: "fixture",
  promptVersion: 1,
  prompt: "Research",
  persona: "",
  geo: "US",
  language: "en",
  sample: 1,
  simulationMethod: "prompt_context",
  collectionMethod: "aggregator_api",
  policyVersion: "v1",
};
it("rejects missing keys without a network request", async () => {
  const transport = vi.fn<typeof fetch>();
  expect(() => createGeminiProvider({ apiKey: "", maxOutputTokens: 128 }, transport)).toThrow();
  expect(await checkGeminiCredential({ apiKey: "", model: "selected" }, transport)).toMatchObject({
    code: "ENGINE_NOT_CONFIGURED",
  });
  expect(transport).not.toHaveBeenCalled();
});
it.each([
  [401, {}, "AUTHENTICATION_ERROR", false],
  [402, {}, "QUOTA_EXHAUSTED", false],
  [403, {}, "PERMISSION_DENIED", false],
  [404, {}, "MODEL_UNAVAILABLE", false],
  [429, {}, "RATE_LIMIT_EXCEEDED", true],
  [429, { error: { message: "Daily quota exhausted secret" } }, "QUOTA_EXHAUSTED", false],
  [503, {}, "PROVIDER_CAPACITY_EXCEEDED", true],
  [502, {}, "PROVIDER_UNAVAILABLE", true],
  [504, {}, "PROVIDER_TIMEOUT", true],
  [501, {}, "PROVIDER_UNAVAILABLE", false],
  [
    402,
    { error: { metadata: { limit_source: "openrouter_in_flight_budget" } } },
    "RATE_LIMIT_EXCEEDED",
    true,
  ],
])("classifies OpenRouter HTTP %s without fallback", async (status, body, category, retryable) => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(body, { status: Number(status), headers: { "Retry-After": "90" } }),
    );
  const other = { execute: vi.fn() };
  const provider = createMultiEngineProvider({
    openrouter: createOpenRouterProvider({ apiKey: "secret", maxOutputTokens: 128 }, transport),
    gemini: other,
  });
  await expect(provider.execute(request)).rejects.toMatchObject({
    category,
    retryable,
    httpStatus: status,
    retryAfter: 90,
  });
  expect(transport).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(String(transport.mock.calls[0][1]?.body));
  expect(sent.model).toBe(request.model);
  expect(sent.models).toBeUndefined();
  expect(sent.provider).toMatchObject({
    allow_fallbacks: false,
    max_price: { prompt: "0.1", completion: "0.5" },
  });
  expect(other.execute).not.toHaveBeenCalled();
});
it("prioritizes grounding quota over a zero allowance and reads quotaMetric", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json(
      {
        error: {
          details: [{ violations: [{ quotaMetric: "google_search_requests", quotaValue: 0 }] }],
        },
      },
      { status: 429 },
    ),
  );
  await expect(
    createGeminiProvider({ apiKey: "secret", maxOutputTokens: 128 }, transport).execute({
      ...request,
      engine: "gemini",
      model: "selected",
    }),
  ).rejects.toMatchObject({
    category: "GROUNDING_QUOTA_EXHAUSTED",
    retryable: false,
    httpStatus: 429,
  });
});
it("marks client timeouts uncertain without replaying paid calls", async () => {
  for (const factory of [createGeminiProvider, createOpenRouterProvider]) {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("secret", "TimeoutError"));
    await expect(
      factory({ apiKey: "secret", maxOutputTokens: 128 }, transport).execute({
        ...request,
        model: factory === createGeminiProvider ? "selected" : request.model,
      }),
    ).rejects.toMatchObject({ category: "PROVIDER_TIMEOUT", retryable: false, uncertain: true });
    expect(transport).toHaveBeenCalledTimes(1);
  }
});
it("reports malformed OpenRouter responses safely", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret-invalid-json"));
  await expect(
    createOpenRouterProvider({ apiKey: "secret", maxOutputTokens: 128 }, transport).execute(
      request,
    ),
  ).rejects.toMatchObject({ category: "INVALID_PROVIDER_RESPONSE", retryable: false });
});
