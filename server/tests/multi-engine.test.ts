import { describe, it, expect } from "vitest";
import {
  createMultiEngineProvider,
  defaultModelForEngine,
} from "../src/services/monitoring/multi-engine.provider.js";
import type {
  MonitoringProvider,
  MonitoringRequest,
  ProviderResult,
} from "../src/services/monitoring/types.js";

function createMockProvider(engineName: string): MonitoringProvider {
  return {
    async execute(request: MonitoringRequest): Promise<ProviderResult> {
      return {
        status: "succeeded",
        text: `Response from ${engineName} for: ${request.prompt}`,
        modelVersion: `${engineName}-test-model`,
        latencyMs: 120,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        citations: [{ url: "https://example.com/source", title: "Source" }],
        searchQueries: [request.prompt],
        searchEntryPoint: null,
        grounded: true,
        raw: { engine: engineName },
        estimatedCostUsd: 0.001,
        refusalReason: null,
      };
    },
  };
}

describe("MultiEngineProvider Dispatcher & Canary Testing", () => {
  const geminiMock = createMockProvider("gemini");
  const openAiMock = createMockProvider("openai");
  const serpMock = createMockProvider("google_ai_overviews");

  const multiProvider = createMultiEngineProvider({
    gemini: geminiMock,
    openai: openAiMock,
    google_ai_overviews: serpMock,
  });

  it("routes requests to the correct engine provider", async () => {
    const geminiRes = await multiProvider.execute({
      engine: "gemini",
      model: "gemini-2.5-flash",
      promptId: "11111111-1111-1111-1111-111111111111",
      promptVersion: 1,
      prompt: "Test Gemini",
      persona: "",
      geo: "US",
      language: "en",
      sample: 1,
      simulationMethod: "prompt_context",
      collectionMethod: "official_api",
      policyVersion: "v1",
    });
    expect(geminiRes.text).toContain("Response from gemini");

    const openAiRes = await multiProvider.execute({
      engine: "openai",
      model: "gpt-4o",
      promptId: "22222222-2222-2222-2222-222222222222",
      promptVersion: 1,
      prompt: "Test OpenAI",
      persona: "",
      geo: "US",
      language: "en",
      sample: 1,
      simulationMethod: "prompt_context",
      collectionMethod: "official_api",
      policyVersion: "v1",
    });
    expect(openAiRes.text).toContain("Response from openai");
  });

  it("rejects execution for unconfigured engines", async () => {
    await expect(
      multiProvider.execute({
        engine: "google_ai_mode",
        model: "test",
        promptId: "33333333-3333-3333-3333-333333333333",
        promptVersion: 1,
        prompt: "Test AI Mode",
        persona: "",
        geo: "US",
        language: "en",
        sample: 1,
        simulationMethod: "prompt_context",
        collectionMethod: "licensed_serp",
        policyVersion: "v1",
      }),
    ).rejects.toMatchObject({
      code: "ENGINE_GOOGLE_AI_MODE_NOT_CONFIGURED",
    });
  });

  it("executes canary tests with canonical prompt and default model", async () => {
    const canaryResult = await multiProvider.canaryTest("openai");
    expect(canaryResult.status).toBe("succeeded");
    expect(canaryResult.grounded).toBe(true);
    expect(canaryResult.text).toContain("Response from openai");
  });
  it("uses a minimal prompt and bounded output for connection checks", async () => {
    let captured: MonitoringRequest | undefined;
    const canary = createMultiEngineProvider({
      openai: {
        execute: async (request) => {
          captured = request;
          return openAiMock.execute(request);
        },
      },
    });
    await canary.canaryTest("openai");
    expect(captured).toMatchObject({
      prompt: "Name one landmark in Paris.",
      maxOutputTokens: 64,
      persona: "",
      sample: 1,
    });
  });

  it("identifies configured engines and provides default models", () => {
    expect(multiProvider.isEngineConfigured("gemini")).toBe(true);
    expect(multiProvider.isEngineConfigured("openai")).toBe(true);
    expect(multiProvider.isEngineConfigured("google_ai_mode")).toBe(false);
    expect(multiProvider.configuredEngines()).toEqual(["gemini", "openai", "google_ai_overviews"]);

    expect(defaultModelForEngine("gemini")).toBe("gemini-2.5-flash");
    expect(defaultModelForEngine("openai")).toBe("gpt-4o");
    expect(defaultModelForEngine("google_ai_overviews")).toBe("google-ai-overview-surface");
    expect(defaultModelForEngine("google_ai_mode")).toBe("google-ai-mode-surface");
  });
});
