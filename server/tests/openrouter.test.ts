import { expect, it, vi } from "vitest";
import {
  createOpenRouterProvider,
  checkOpenRouterCredential,
} from "../src/services/monitoring/openrouter.adapter.js";
import type { MonitoringRequest } from "../src/services/monitoring/types.js";

const request: MonitoringRequest = {
  engine: "openrouter",
  model: "openai/gpt-6-luna",
  promptId: "00000000-0000-4000-8000-000000000001",
  promptVersion: 1,
  prompt: "Research question",
  persona: "",
  geo: "US",
  language: "en",
  sample: 1,
  collectionMethod: "aggregator_api",
  simulationMethod: "prompt_context",
  policyVersion: "test",
};

it("uses paid Luna routing caps and native web search without pricier fallbacks", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      model: request.model,
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: "A sourced answer.",
            annotations: [
              {
                type: "url_citation",
                url_citation: { url: "https://example.com/source", title: "Source" },
              },
            ],
          },
        },
      ],
      usage: { total_tokens: 20 },
    }),
  );
  const result = await createOpenRouterProvider(
    { apiKey: "sk-or-fixture", maxOutputTokens: 512 },
    transport,
  ).execute(request);
  expect(transport.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  const options = transport.mock.calls[0][1];
  expect(options?.headers).toMatchObject({ Authorization: "Bearer sk-or-fixture" });
  const body = JSON.parse(String(options?.body));
  expect(body.model).toBe(request.model);
  expect(body.provider).toEqual({
    allow_fallbacks: false,
    max_price: { prompt: "0.1", completion: "0.5" },
  });
  expect(body.plugins).toEqual([{ id: "web", engine: "native", max_results: 5 }]);
  expect(body).not.toHaveProperty("models");
  expect(result).toMatchObject({
    status: "succeeded",
    grounded: true,
    citations: [{ url: "https://example.com/source", title: "Source" }],
    searchQueries: [],
    estimatedCostUsd: null,
  });
});

it("does not treat generated markdown links as retrieved citations", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "See [example](https://example.com)." },
        },
      ],
    }),
  );
  const result = await createOpenRouterProvider(
    { apiKey: "sk-or-fixture", maxOutputTokens: 512 },
    transport,
  ).execute(request);
  expect(result).toMatchObject({ grounded: false, citations: [] });
});

it("forwards configured model identifiers without imposing a provider-specific format", async () => {
  const transport = vi.fn<typeof fetch>();
  transport.mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({
      model: body.model,
      choices: [{ finish_reason: "stop", message: { content: "Answer" } }],
    });
  });
  const provider = createOpenRouterProvider({ apiKey: "fixture", maxOutputTokens: 64 }, transport);
  for (const model of [
    "custom-provider/model-name:variant",
    "vendor/model?parameter=value",
    "models/with/multiple/path-segments",
  ]) {
    await provider.execute({ ...request, model });
  }
  expect(
    transport.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).model),
  ).toEqual([
    "custom-provider/model-name:variant",
    "vendor/model?parameter=value",
    "models/with/multiple/path-segments",
  ]);
});

it("retries 429s through the bounded worker policy but not auth or incomplete answers", async () => {
  for (const [response, code] of [
    [new Response("secret error body", { status: 429 }), "PROVIDER_RATE_LIMITED_RETRYABLE"],
    [new Response("secret error body", { status: 401 }), "PROVIDER_HTTP_401"],
    [
      Response.json({ choices: [{ finish_reason: "length", message: { content: "partial" } }] }),
      "PROVIDER_INCOMPLETE_ANSWER",
    ],
  ] as const) {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      createOpenRouterProvider({ apiKey: "fixture", maxOutputTokens: 64 }, transport).execute(
        request,
      ),
    ).rejects.toMatchObject({
      code,
      retryable: code === "PROVIDER_RATE_LIMITED_RETRYABLE",
      ...(code === "PROVIDER_RATE_LIMITED_RETRYABLE" ? { retryAfter: 0 } : {}),
    });
    expect(transport).toHaveBeenCalledTimes(1);
  }
});

it("respects an explicit provider retry delay without making another call", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
  await expect(
    createOpenRouterProvider({ apiKey: "fixture", maxOutputTokens: 64 }, transport).execute(
      request,
    ),
  ).rejects.toMatchObject({
    code: "PROVIDER_RATE_LIMITED_RETRYABLE",
    retryable: true,
    retryAfter: 60,
  });
  expect(transport).toHaveBeenCalledTimes(1);
});

it("validates the key and paid model catalog entry using metadata only", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: {} }))
    .mockResolvedValueOnce(
      Response.json({
        data: [{ id: request.model, pricing: { prompt: "0.0000001", completion: "0.0000005" } }],
      }),
    );
  expect(
    await checkOpenRouterCredential({ apiKey: "fixture", model: request.model }, transport),
  ).toMatchObject({ ok: true, freeModel: false, configuredModelAvailable: true });
  for (const [url, options] of transport.mock.calls) {
    expect(String(url)).not.toContain("chat/completions");
    expect(options?.body).toBeUndefined();
  }
});
