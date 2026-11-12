import { describe, it, expect } from "vitest";
import { createOpenAIProvider } from "../src/services/monitoring/openai.adapter.js";
import type { MonitoringRequest } from "../src/services/monitoring/types.js";

const baseRequest: MonitoringRequest = {
  engine: "openai",
  model: "gpt-4o",
  promptId: "11111111-1111-1111-1111-111111111111",
  promptVersion: 1,
  prompt: "Which enterprise CRM software is best for B2B SaaS?",
  persona: "Enterprise buyer",
  geo: "US",
  language: "en",
  sample: 1,
  simulationMethod: "prompt_context",
  collectionMethod: "official_api",
  policyVersion: "monitoring-v1",
};

describe("OpenAI Monitoring Adapter", () => {
  it("executes request with web search citations from annotations and markdown links", async () => {
    let sentUrl = "";
    let sentBody: Record<string, unknown> = {};
    const fakeTransport: typeof fetch = async (input, init) => {
      sentUrl = String(input);
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "resp_test123",
          model: "gpt-4o-2024-08-06",
          status: "completed",
          incomplete_details: null,
          output: [
            {
              type: "web_search_call",
              action: { type: "search", queries: ["best B2B SaaS CRM"] },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "For B2B SaaS, top CRMs include [Salesforce](https://salesforce.com) and [HubSpot](https://hubspot.com).",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://g2.com/categories/crm",
                      title: "Best CRM Software - G2",
                    },
                  ],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 150,
            output_tokens: 80,
            total_tokens: 230,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const provider = createOpenAIProvider(
      {
        apiKey: "sk-fake-key",
        maxOutputTokens: 2048,
        inputUsdPerMillion: 2.5,
        outputUsdPerMillion: 10,
      },
      fakeTransport,
    );

    const result = await provider.execute(baseRequest);

    expect(result.status).toBe("succeeded");
    expect(result.text).toContain("For B2B SaaS");
    expect(result.modelVersion).toBe("gpt-4o-2024-08-06");
    expect(result.grounded).toBe(true);
    expect(result.citations).toHaveLength(3);
    expect(result.citations.map((c) => c.url)).toContain("https://g2.com/categories/crm");
    expect(result.citations.map((c) => c.url)).toContain("https://salesforce.com");
    expect(result.citations.map((c) => c.url)).toContain("https://hubspot.com");
    expect(result.usage.inputTokens).toBe(150);
    expect(result.usage.outputTokens).toBe(80);
    expect(result.estimatedCostUsd).toBeCloseTo((150 * 2.5 + 80 * 10) / 1000000, 6);
    expect(sentUrl).toBe("https://api.openai.com/v1/responses");
    expect(sentBody).toMatchObject({
      model: "gpt-4o",
      tools: [{ type: "web_search" }],
      max_output_tokens: 2048,
      store: false,
    });
    expect(sentBody.input).toContain(baseRequest.prompt);
  });

  it("handles model refusals cleanly", async () => {
    const fakeTransport: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "gpt-4o",
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "refusal",
                  refusal: "I cannot fulfill this request due to content policy.",
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const provider = createOpenAIProvider(
      { apiKey: "sk-fake-key", maxOutputTokens: 1000 },
      fakeTransport,
    );

    const result = await provider.execute(baseRequest);
    expect(result.status).toBe("refused");
    expect(result.refusalReason).toBe("I cannot fulfill this request due to content policy.");
    expect(result.grounded).toBe(false);
  });

  it("extracts search queries from Responses web search actions", async () => {
    const fakeTransport: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "gpt-4o",
          status: "completed",
          output: [
            {
              type: "web_search_call",
              action: { type: "search", queries: ["best B2B SaaS CRM 2026"] },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Here are the top options based on recent reviews. [Software Advice](https://softwareadvice.com/crm)",
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const provider = createOpenAIProvider(
      { apiKey: "sk-fake-key", maxOutputTokens: 1000 },
      fakeTransport,
    );

    const result = await provider.execute(baseRequest);
    expect(result.searchQueries).toContain("best B2B SaaS CRM 2026");
    expect(result.citations[0].url).toBe("https://softwareadvice.com/crm");
  });

  it("translates 429 rate limit with Retry-After header into retryable provider error", async () => {
    const fakeTransport: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
        status: 429,
        headers: { "Retry-After": "45" },
      });

    const provider = createOpenAIProvider(
      { apiKey: "sk-fake-key", maxOutputTokens: 1000 },
      fakeTransport,
    );

    await expect(provider.execute(baseRequest)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfter: 45,
    });
  });

  it("rejects incomplete Responses when output tokens are exhausted", async () => {
    const fakeTransport: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          model: "gpt-4o",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Truncated answer that cut off halfway..." }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const provider = createOpenAIProvider(
      { apiKey: "sk-fake-key", maxOutputTokens: 100 },
      fakeTransport,
    );

    await expect(provider.execute(baseRequest)).rejects.toMatchObject({
      code: "PROVIDER_INCOMPLETE_ANSWER",
      retryable: true,
    });
  });

  it("handles network connection abort or failure as uncertain", async () => {
    const failingTransport: typeof fetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };

    const provider = createOpenAIProvider(
      { apiKey: "sk-fake-key", maxOutputTokens: 100 },
      failingTransport,
    );

    await expect(provider.execute(baseRequest)).rejects.toMatchObject({
      code: "PROVIDER_NETWORK_UNCERTAIN",
      uncertain: true,
      retryable: false,
    });
  });

  it("does not automatically repeat a successful provider call with an unusable body", async () => {
    const fakeTransport: typeof fetch = async () =>
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const provider = createOpenAIProvider(
      { apiKey: "sk-fake-key", maxOutputTokens: 1000 },
      fakeTransport,
    );

    await expect(provider.execute(baseRequest)).rejects.toMatchObject({
      code: "PROVIDER_MALFORMED",
      retryable: false,
    });
  });
});
