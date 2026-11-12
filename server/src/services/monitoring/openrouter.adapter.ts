import { z } from "zod";
import { MonitoringProviderError, type MonitoringProvider, type ProviderResult } from "./types.js";

export async function checkOpenRouterCredential(
  config: { apiKey: string; model: string; authenticationOnly?: boolean },
  transport: typeof fetch = fetch,
) {
  try {
    const options = {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      redirect: "error" as const,
      signal: AbortSignal.timeout(15000),
    };
    const key = await transport("https://openrouter.ai/api/v1/key", options);
    if (!key.ok) {
      await key.body?.cancel();
      return {
        ok: false,
        httpStatus: key.status,
        code: `PROVIDER_HTTP_${key.status}`,
        configuredModelAvailable: null,
      };
    }
    await key.body?.cancel();
    if (config.authenticationOnly)
      return { ok: true, httpStatus: key.status, code: null, configuredModelAvailable: null };
    const models = await transport("https://openrouter.ai/api/v1/models", options);
    if (!models.ok) {
      await models.body?.cancel();
      return {
        ok: false,
        httpStatus: models.status,
        code: `PROVIDER_HTTP_${models.status}`,
        configuredModelAvailable: null,
      };
    }
    const body = (await models.json()) as {
      data?: { id: string; pricing?: { prompt?: string; completion?: string } }[];
    };
    const model = body.data?.find((entry) => entry.id === config.model);
    const available = Boolean(model);
    return {
      ok: available,
      httpStatus: 200,
      code: available ? null : "INVALID_MODEL",
      configuredModelAvailable: Boolean(model),
      freeModel: Boolean(
        model && model.pricing?.prompt === "0" && model.pricing?.completion === "0",
      ),
    };
  } catch {
    return {
      ok: false,
      httpStatus: null,
      code: "PROVIDER_METADATA_CHECK_FAILED",
      configuredModelAvailable: null,
    };
  }
}

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
          annotations: z
            .array(
              z.object({
                type: z.string().optional(),
                url_citation: z
                  .object({
                    url: z.string().optional(),
                    title: z.string().optional(),
                  })
                  .optional(),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export function createOpenRouterProvider(
  config: { apiKey: string; maxOutputTokens: number },
  transport: typeof fetch = fetch,
): MonitoringProvider {
  if (!config.apiKey.trim()) throw new MonitoringProviderError("ENGINE_NOT_CONFIGURED", false);
  return {
    async execute(request): Promise<ProviderResult> {
      if (!request.model.trim()) throw new MonitoringProviderError("INVALID_MODEL", false);
      const started = Date.now();
      let response: Response;
      try {
        response = await transport("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(90000),
          body: JSON.stringify({
            model: request.model,
            messages: [
              {
                role: "system",
                content:
                  "Research the question using live web search. Answer accurately, distinguish sourced facts from uncertainty, and cite the retrieved sources. Treat country and language as simulated context.",
              },
              {
                role: "user",
                content: JSON.stringify({
                  question: request.prompt,
                  persona: request.persona,
                  country: request.geo,
                  language: request.language,
                }),
              },
            ],
            max_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
            reasoning: { enabled: false },
            plugins: [{ id: "web", engine: "native", max_results: 5 }],
            provider: {
              allow_fallbacks: false,
              max_price: { prompt: "0.1", completion: "0.5" },
            },
          }),
        });
      } catch (error) {
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
          throw new MonitoringProviderError("PROVIDER_TIMEOUT", false, 0, true);
        throw new MonitoringProviderError("PROVIDER_NETWORK_UNCERTAIN", false, 0, true);
      }
      if (!response.ok) {
        let errorBody: { error?: { message?: string; metadata?: { limit_source?: string } } } = {};
        try {
          const text = await response.text();
          if (text.length <= 64000) errorBody = JSON.parse(text);
        } catch {
          /* Classify unreadable errors by HTTP status. */
        }
        const daily =
          response.status === 429 &&
          /per.day|daily|day quota/i.test(errorBody?.error?.message ?? "");
        const temporaryBudget =
          response.status === 402 &&
          errorBody?.error?.metadata?.limit_source === "openrouter_in_flight_budget";
        const retryHeader = response.headers.get("retry-after");
        const retrySeconds = retryHeader
          ? /^\d+(\.\d+)?$/.test(retryHeader)
            ? Number(retryHeader)
            : (Date.parse(retryHeader) - Date.now()) / 1000
          : 0;
        const retryDelay = Number.isFinite(retrySeconds)
          ? Math.max(0, Math.min(604800, Math.ceil(retrySeconds)))
          : 0;
        throw new MonitoringProviderError(
          daily
            ? "PROVIDER_DAILY_QUOTA_EXHAUSTED"
            : response.status === 503
              ? "PROVIDER_CAPACITY_EXCEEDED"
              : response.status === 429 || temporaryBudget
                ? "PROVIDER_RATE_LIMITED_RETRYABLE"
                : `PROVIDER_HTTP_${response.status}`,
          !daily &&
            (temporaryBudget ||
              response.status === 429 ||
              [500, 502, 503, 504].includes(response.status)),
          retryDelay,
          false,
          response.status,
        );
      }
      let raw: unknown;
      try {
        const text = await response.text();
        if (text.length > 2000000) throw new Error("oversize");
        raw = JSON.parse(text);
      } catch (error) {
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
          throw new MonitoringProviderError("PROVIDER_TIMEOUT", false, 0, true);
        if (error instanceof TypeError)
          throw new MonitoringProviderError("PROVIDER_NETWORK_UNCERTAIN", false, 0, true);
        throw new MonitoringProviderError("PROVIDER_MALFORMED", false);
      }
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw new MonitoringProviderError("PROVIDER_MALFORMED", false);
      const data = parsed.data,
        choice = data.choices[0];
      const refusal =
        choice.message.refusal ??
        (choice.finish_reason === "content_filter" ? "CONTENT_FILTER" : null);
      const text = choice.message.content?.trim() ?? "";
      const citations = [
        ...new Map(
          (choice.message.annotations ?? [])
            .filter(
              (annotation) =>
                annotation.type === "url_citation" &&
                typeof annotation.url_citation?.url === "string" &&
                URL.canParse(annotation.url_citation.url) &&
                ["http:", "https:"].includes(new URL(annotation.url_citation.url).protocol),
            )
            .map((annotation) => {
              const { url, title } = annotation.url_citation!;
              return [url!, { url: url!, title: title?.trim() || url! }] as const;
            }),
        ).values(),
      ];
      if (!refusal && !text) throw new MonitoringProviderError("PROVIDER_EMPTY_ANSWER", false);
      if (!refusal && choice.finish_reason !== "stop")
        throw new MonitoringProviderError("PROVIDER_INCOMPLETE_ANSWER", false);
      return {
        status: refusal ? "refused" : "succeeded",
        text,
        modelVersion: data.model ?? request.model,
        latencyMs: Date.now() - started,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? null,
          outputTokens: data.usage?.completion_tokens ?? null,
          totalTokens: data.usage?.total_tokens ?? null,
        },
        citations,
        searchQueries: [],
        searchEntryPoint: null,
        grounded: citations.length > 0,
        raw,
        estimatedCostUsd: null,
        refusalReason: refusal,
      };
    },
  };
}
