import {
  MonitoringProviderError,
  type MonitoringEngineType,
  type MonitoringProvider,
  type MonitoringRequest,
  type ProviderResult,
} from "./types.js";

export interface MultiEngineProvider extends MonitoringProvider {
  canaryTest(engine: MonitoringEngineType, model?: string): Promise<ProviderResult>;
  isEngineConfigured(engine: MonitoringEngineType): boolean;
  configuredEngines(): MonitoringEngineType[];
}

export function defaultModelForEngine(engine: MonitoringEngineType): string {
  switch (engine) {
    case "openrouter":
      return "openai/gpt-6-luna";
    case "gemini":
      return "gemini-2.5-flash";
    case "openai":
      return "gpt-4o";
    case "google_ai_overviews":
      return "google-ai-overview-surface";
    case "google_ai_mode":
      return "google-ai-mode-surface";
  }
}

export function createMultiEngineProvider(
  providers: Partial<Record<MonitoringEngineType, MonitoringProvider>>,
): MultiEngineProvider {
  return {
    async execute(request: MonitoringRequest): Promise<ProviderResult> {
      const provider = providers[request.engine];
      if (!provider) {
        throw new MonitoringProviderError(
          `ENGINE_${request.engine.toUpperCase()}_NOT_CONFIGURED`,
          false,
        );
      }
      return provider.execute(request);
    },

    isEngineConfigured(engine: MonitoringEngineType): boolean {
      return Boolean(providers[engine]);
    },

    configuredEngines(): MonitoringEngineType[] {
      return (Object.keys(providers) as MonitoringEngineType[]).filter((e) =>
        Boolean(providers[e]),
      );
    },

    async canaryTest(engine: MonitoringEngineType, model?: string): Promise<ProviderResult> {
      const provider = providers[engine];
      if (!provider) {
        throw new MonitoringProviderError(`ENGINE_${engine.toUpperCase()}_NOT_CONFIGURED`, false);
      }

      const canaryRequest: MonitoringRequest = {
        engine,
        model: model ?? defaultModelForEngine(engine),
        promptId: "00000000-0000-0000-0000-000000000000",
        promptVersion: 1,
        prompt: "Name one landmark in Paris.",
        maxOutputTokens: 64,
        persona: "",
        geo: "US",
        language: "en",
        sample: 1,
        simulationMethod: "prompt_context",
        collectionMethod:
          engine === "openrouter"
            ? "aggregator_api"
            : engine.startsWith("google_ai_")
              ? "licensed_serp"
              : "official_api",
        policyVersion: "canary-v1",
      };

      return provider.execute(canaryRequest);
    },
  };
}
