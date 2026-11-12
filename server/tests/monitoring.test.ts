import { expect, it, vi } from "vitest";
import { createGeminiProvider } from "../src/services/monitoring/gemini.adapter.js";
import { checkGeminiCredential } from "../src/services/monitoring/gemini-auth.js";
import { runInput, scheduleInput, boundBatch } from "../src/validations/monitoring.validation.js";
import type { MonitoringRequest } from "../src/services/monitoring/types.js";
const req: MonitoringRequest = {
  engine: "gemini",
  model: "gemini-3.8-flash",
  promptId: "00000000-0000-4000-8000-000000000001",
  promptVersion: 1,
  prompt: "Best tea brands?",
  persona: "buyer",
  geo: "US",
  language: "en",
  sample: 1,
  simulationMethod: "prompt_context",
  collectionMethod: "official_api",
  policyVersion: "monitoring-v1",
};

it("classifies rejected Gemini credentials without storing raw messages or retrying authentication", async () => {
  for (const [status, reason, code] of [
    [401, "ACCESS_TOKEN_TYPE_UNSUPPORTED", "PROVIDER_AUTH_TOKEN_UNSUPPORTED"],
    [400, "API_KEY_INVALID", "PROVIDER_API_KEY_INVALID"],
    [403, "API_KEY_SERVICE_BLOCKED", "PROVIDER_API_KEY_RESTRICTED"],
    [401, "UNKNOWN_SECRET_REASON", "PROVIDER_HTTP_401"],
  ] as const) {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: "secret-key-never-log", details: [{ reason }] } },
          { status },
        ),
      );
    const provider = createGeminiProvider(
      { apiKey: "AQ.fixture-key", maxOutputTokens: 2048 },
      fetcher,
    );
    await expect(provider.execute(req)).rejects.toMatchObject({
      code,
      retryable: false,
      uncertain: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const options = fetcher.mock.calls[0][1];
    expect(options?.headers).toMatchObject({ "x-goog-api-key": "AQ.fixture-key" });
    expect(options?.headers).not.toHaveProperty("Authorization");
  }
});

it("checks Gemini credentials and model access using metadata without generating content", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ name: `models/${req.model}` }));
  expect(
    await checkGeminiCredential({ apiKey: "fixture-key", model: req.model }, fetcher),
  ).toMatchObject({ ok: true, configuredModelAvailable: true });
  expect(String(fetcher.mock.calls[0][0])).toBe(
    `https://generativelanguage.googleapis.com/v1beta/models/${req.model}`,
  );
  expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
  expect(fetcher.mock.calls[0][1]?.method).not.toBe("POST");
  const denied = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json(
      {
        error: {
          message: "secret-key-never-log",
          details: [
            {
              reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED",
              metadata: { credential: "secret-key-never-log" },
            },
          ],
        },
      },
      { status: 401 },
    ),
  );
  const result = await checkGeminiCredential(
    { apiKey: "secret-key-never-log", model: req.model },
    denied,
  );
  expect(result).toMatchObject({
    ok: false,
    httpStatus: 401,
    code: "PROVIDER_AUTH_TOKEN_UNSUPPORTED",
  });
  expect(JSON.stringify(result)).not.toContain("secret-key-never-log");
});
const success = {
  modelVersion: "gemini-fixture-v1",
  candidates: [
    {
      finishReason: "STOP",
      content: { parts: [{ text: "An evidence-based answer" }] },
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com/source", title: "Source" } }],
        webSearchQueries: ["tea"],
        searchEntryPoint: { renderedContent: "<div>Google</div>" },
      },
    },
  ],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
};
it("distinguishes explicit grounding and daily quota failures from transient limits", async () => {
  for (const [quotaId, code] of [
    ["SearchGroundingRequestsPerDay", "PROVIDER_GROUNDING_QUOTA_EXHAUSTED"],
    ["GenerateRequestsPerDay", "PROVIDER_DAILY_QUOTA_EXHAUSTED"],
  ]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { details: [{ violations: [{ quotaId }] }] } }), {
        status: 429,
      }),
    );
    await expect(
      createGeminiProvider({ apiKey: "private-key", maxOutputTokens: 2048 }, fetcher).execute(req),
    ).rejects.toMatchObject({ code, retryable: false });
  }
});
it("requests search grounding, discloses simulated locale and captures evidence metadata", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(success)));
  const result = await createGeminiProvider(
    { apiKey: "private-key", maxOutputTokens: 2048 },
    fetcher,
  ).execute(req);
  const [url, options] = fetcher.mock.calls[0]!;
  expect(String(url)).not.toContain("private-key");
  const body = JSON.parse(String(options?.body));
  expect(body.tools).toEqual([{ google_search: {} }]);
  expect(body.contents[0].parts[0].text).toContain('"country":"US"');
  expect(result.grounded).toBe(true);
  expect(result.modelVersion).toBe("gemini-fixture-v1");
  expect(result.usage.totalTokens).toBe(30);
  expect(result.estimatedCostUsd).toBeNull();
  expect(result.raw).toEqual(success);
});
it("records observed refusals rather than treating them as technical failures", async () => {
  const provider = createGeminiProvider(
    { apiKey: "key", maxOutputTokens: 2048 },
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })),
      ),
  );
  expect(await provider.execute(req)).toMatchObject({
    status: "refused",
    refusalReason: "SAFETY",
    text: "",
  });
});
it("honors numeric and date Retry-After and classifies hard errors", async () => {
  for (const retry of ["120", new Date(Date.now() + 120000).toUTCString()]) {
    const provider = createGeminiProvider(
      { apiKey: "key", maxOutputTokens: 2048 },
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": retry } })),
    );
    await expect(provider.execute(req)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED_RETRYABLE",
      retryable: true,
      retryAfter: expect.any(Number),
    });
  }
  const provider = createGeminiProvider(
    { apiKey: "key", maxOutputTokens: 2048 },
    vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 403 })),
  );
  await expect(provider.execute(req)).rejects.toMatchObject({
    code: "PROVIDER_HTTP_403",
    retryable: false,
  });
});

it("retries unidentified 429s with worker backoff but stops for an explicit zero quota", async () => {
  for (const [details, code] of [
    [[], "PROVIDER_RATE_LIMITED_RETRYABLE"],
    [
      [
        {
          violations: [{ quotaId: "GenerateRequestsPerMinute", quotaValue: "0" }],
          retryDelay: "10s",
        },
      ],
      "PROVIDER_QUOTA_UNAVAILABLE",
    ],
  ] as const) {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { details } }, { status: 429 }));
    const provider = createGeminiProvider({ apiKey: "fixture", maxOutputTokens: 2048 }, transport);
    await expect(provider.execute(req)).rejects.toMatchObject({
      code,
      retryable: code === "PROVIDER_RATE_LIMITED_RETRYABLE",
      ...(code === "PROVIDER_RATE_LIMITED_RETRYABLE" ? { retryAfter: 0 } : {}),
    });
    expect(transport).toHaveBeenCalledTimes(1);
  }
});

it("honors the longer explicit Google RetryInfo delay instead of a short local retry", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { details: [{ retryDelay: "90.5s" }] } },
        { status: 429, headers: { "Retry-After": "10" } },
      ),
    );
  const provider = createGeminiProvider({ apiKey: "fixture", maxOutputTokens: 2048 }, transport);
  await expect(provider.execute(req)).rejects.toMatchObject({
    code: "PROVIDER_RATE_LIMITED_RETRYABLE",
    retryable: true,
    retryAfter: 91,
  });
});
it("does not automatically retry ambiguous network calls and rejects empty/malformed results", async () => {
  await expect(
    createGeminiProvider(
      { apiKey: "key", maxOutputTokens: 2048 },
      vi.fn<typeof fetch>().mockRejectedValue(new Error("network")),
    ).execute(req),
  ).rejects.toMatchObject({ uncertain: true, retryable: false });
  for (const body of [
    "bad json",
    JSON.stringify({}),
    JSON.stringify({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial" }] } }],
    }),
  ])
    await expect(
      createGeminiProvider(
        { apiKey: "key", maxOutputTokens: 2048 },
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      ).execute(req),
    ).rejects.toMatchObject({ retryable: true });
});
it("rejects unavailable engines, duplicate prompts and oversized batches; applies sampling defaults", () => {
  expect(runInput.parse({ promptIds: [req.promptId] }).samples).toBe(3);
  expect(scheduleInput.parse({ promptIds: [req.promptId] }).samples).toBe(1);
  expect(runInput.safeParse({ engine: "openai", promptIds: [req.promptId] }).success).toBe(true);
  expect(
    runInput.safeParse({ engine: "unsupported_engine" as "gemini", promptIds: [req.promptId] })
      .success,
  ).toBe(false);
  expect(runInput.safeParse({ promptIds: [req.promptId, req.promptId] }).success).toBe(false);
  expect(scheduleInput.safeParse({ promptIds: [req.promptId], cadence: "custom" }).success).toBe(
    false,
  );
  expect(() =>
    boundBatch({
      engine: "gemini",
      promptIds: Array(100).fill(req.promptId),
      geos: ["US", "GB"],
      languages: ["en"],
      samples: 5,
    }),
  ).toThrow();
});
