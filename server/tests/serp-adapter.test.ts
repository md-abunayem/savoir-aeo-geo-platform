import { describe, it, expect, vi } from "vitest";
import { createSerpProvider } from "../src/services/monitoring/serp.adapter.js";
import type { MonitoringRequest } from "../src/services/monitoring/types.js";

const aiOverviewRequest: MonitoringRequest = {
  engine: "google_ai_overviews",
  model: "google-ai-overview-surface",
  promptId: "22222222-2222-2222-2222-222222222222",
  promptVersion: 1,
  prompt: "How does AEO differ from traditional SEO?",
  persona: "Search Marketer",
  geo: "US",
  language: "en",
  sample: 1,
  simulationMethod: "prompt_context",
  collectionMethod: "licensed_serp",
  policyVersion: "monitoring-v1",
};

const aiModeRequest: MonitoringRequest = {
  ...aiOverviewRequest,
  engine: "google_ai_mode",
  model: "google-ai-mode-surface",
};

describe("Licensed SERP Vendor Adapter", () => {
  it("calls the Serper Search endpoint and extracts AI Overview references", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeTransport: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          searchParameters: { q: "How does AEO differ from traditional SEO?", gl: "us", hl: "en" },
          aiOverview: {
            text: "AEO (Answer Engine Optimization) focuses on optimizing content for AI-driven answers.",
            references: [
              {
                title: "Search Engine Land: Guide to AEO",
                link: "https://searchengineland.com/aeo-guide",
              },
              {
                title: "HubSpot AEO vs SEO",
                link: "https://blog.hubspot.com/marketing/aeo-vs-seo",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const provider = createSerpProvider(
      { apiKey: "serp-fake-key", costPerCallUsd: 0.002 },
      fakeTransport,
    );

    const result = await provider.execute(aiOverviewRequest);

    expect(result.status).toBe("succeeded");
    expect(result.text).toContain("AEO (Answer Engine Optimization)");
    expect(result.grounded).toBe(true);
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].url).toBe("https://searchengineland.com/aeo-guide");
    expect(result.estimatedCostUsd).toBe(0.002);
    expect(capturedUrl).toBe("https://google.serper.dev/search");
    expect(capturedInit?.headers).toEqual({
      "X-API-KEY": "serp-fake-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      q: aiOverviewRequest.prompt,
      gl: "us",
      hl: "en",
      num: 10,
    });
  });

  it("does not claim Serper supports Google AI Mode", async () => {
    const fakeTransport = vi.fn<typeof fetch>();
    const provider = createSerpProvider({ apiKey: "serp-fake-key" }, fakeTransport);

    await expect(provider.execute(aiModeRequest)).rejects.toMatchObject({
      code: "ENGINE_GOOGLE_AI_MODE_NOT_CONFIGURED",
    });
    expect(fakeTransport).not.toHaveBeenCalled();
  });

  it("factually captures lack of AI Overview when Google does not trigger one", async () => {
    const fakeTransport: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          organic: [
            { title: "Normal Organic Link", link: "https://example.com", snippet: "Classic SERP" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const provider = createSerpProvider(
      { apiKey: "serp-fake-key", costPerCallUsd: 0.001 },
      fakeTransport,
    );

    const result = await provider.execute(aiOverviewRequest);

    expect(result.status).toBe("succeeded");
    expect(result.grounded).toBe(false);
    expect(result.citations).toHaveLength(0);
    expect(result.text).toContain("No Google AI Overview was triggered");
  });

  it("handles SERP vendor 429 rate limits with retryable backoff", async () => {
    const fakeTransport: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { "Retry-After": "30" },
      });

    const provider = createSerpProvider({ apiKey: "serp-fake-key" }, fakeTransport);

    await expect(provider.execute(aiOverviewRequest)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfter: 30,
      httpStatus: 429,
    });
  });
});
