import "../config/load-env.js";
import { parseEnvironment } from "../config/env.js";
import { createGeminiProvider } from "../services/monitoring/gemini.adapter.js";
import { MonitoringProviderError } from "../services/monitoring/types.js";

const env = parseEnvironment(process.env);
try {
  const provider = createGeminiProvider(
    { apiKey: env.GEMINI_API_KEY ?? "", maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS },
    async (input, init) => {
      if (process.argv.includes("--without-grounding") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        delete body.tools;
        init = { ...init, body: JSON.stringify(body) };
      }
      const response = await fetch(input, init);
      return response;
    },
  );
  const result = await provider.execute({
    engine: "gemini",
    model: env.GEMINI_MODEL,
    promptId: "00000000-0000-0000-0000-000000000000",
    promptVersion: 1,
    prompt:
      "Use Google Search to confirm the official website of the Louvre museum in Paris. Answer in two sentences with a source.",
    persona: "",
    geo: "FR",
    language: "en",
    sample: 1,
    simulationMethod: "prompt_context",
    collectionMethod: "official_api",
    policyVersion: "live-smoke-v1",
  });
  console.log(
    JSON.stringify({
      status: result.status,
      model: result.modelVersion,
      grounded: result.grounded,
      citations: result.citations,
      text: result.text,
      usage: result.usage,
      latencyMs: result.latencyMs,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: error instanceof MonitoringProviderError ? error.code : "PROVIDER_CHECK_FAILED",
    }),
  );
  process.exitCode = 1;
}
