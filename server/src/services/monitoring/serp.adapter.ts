import { z } from "zod";
import { MonitoringProviderError, type MonitoringProvider, type ProviderResult } from "./types.js";

const serpResponseSchema = z
  .object({
    searchParameters: z
      .object({
        q: z.string().optional(),
        gl: z.string().optional(),
        hl: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    aiOverview: z
      .object({
        snippet: z.union([z.string(), z.array(z.string())]).optional(),
        text: z.string().optional(),
        markdown: z.string().optional(),
        sources: z
          .array(
            z
              .object({
                title: z.string().optional(),
                link: z.string().optional(),
                snippet: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
        references: z
          .array(
            z
              .object({
                title: z.string().optional(),
                link: z.string().optional(),
                snippet: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    ai_overview: z
      .object({
        summary: z.string().optional(),
        citations: z
          .array(
            z
              .object({
                title: z.string().optional(),
                url: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    organic: z
      .array(
        z
          .object({
            title: z.string().optional(),
            link: z.string().optional(),
            snippet: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export function createSerpProvider(
  config: {
    apiKey: string;
    baseUrl?: string;
    costPerCallUsd?: number;
  },
  transport: typeof fetch = fetch,
): MonitoringProvider {
  if (!config.apiKey) throw new Error("SERP provider API key required");
  const baseUrl = (config.baseUrl ?? "https://google.serper.dev").replace(/\/+$/, "");

  return {
    async execute(request) {
      if (request.engine !== "google_ai_overviews")
        throw new MonitoringProviderError("ENGINE_GOOGLE_AI_MODE_NOT_CONFIGURED", false);

      const start = Date.now();
      let response: Response;

      try {
        response = await transport(`${baseUrl}/search`, {
          method: "POST",
          headers: {
            "X-API-KEY": config.apiKey,
            "Content-Type": "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(60000),
          body: JSON.stringify({
            q: request.prompt,
            gl: request.geo.toLowerCase(),
            hl: request.language.toLowerCase(),
            num: 10,
          }),
        });
      } catch {
        throw new MonitoringProviderError("PROVIDER_NETWORK_UNCERTAIN", false, 0, true);
      }

      if (!response.ok) {
        const retry = response.headers.get("retry-after");
        const numeric = retry ? Number(retry) : NaN;
        const wait = retry
          ? Number.isFinite(numeric)
            ? numeric
            : Math.ceil((Date.parse(retry) - Date.now()) / 1000)
          : 0;
        const delay = Number.isFinite(wait) ? Math.min(604800, Math.max(0, wait)) : 0;
        await response.body?.cancel();
        throw new MonitoringProviderError(
          response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_HTTP_" + response.status,
          response.status === 429 || response.status >= 500,
          delay,
          false,
          response.status,
        );
      }

      let raw: unknown;
      try {
        const text = await response.text();
        if (text.length > 2000000) throw new Error("oversize");
        raw = JSON.parse(text);
      } catch {
        throw new MonitoringProviderError("PROVIDER_MALFORMED", true);
      }

      const parsed = serpResponseSchema.safeParse(raw);
      if (!parsed.success) throw new MonitoringProviderError("PROVIDER_MALFORMED", true);

      const data = parsed.data;

      // Extract the AI Overview text and source references.
      let text = "";
      const citationMap = new Map<string, string>();

      const aiOver = data.aiOverview;
      if (aiOver) {
        if (typeof aiOver.snippet === "string") {
          text = aiOver.snippet;
        } else if (Array.isArray(aiOver.snippet)) {
          text = aiOver.snippet.join("\n\n");
        } else if (aiOver.text) {
          text = aiOver.text;
        } else if (aiOver.markdown) {
          text = aiOver.markdown;
        }

        const rawSources = aiOver.sources || aiOver.references || [];
        for (const s of rawSources) {
          if (s.link && URL.canParse(s.link)) {
            const u = new URL(s.link);
            if (["http:", "https:"].includes(u.protocol)) {
              citationMap.set(s.link, s.title ?? "");
            }
          }
        }
      } else if (data.ai_overview) {
        text = data.ai_overview.summary || "";
        for (const citation of data.ai_overview.citations || []) {
          if (citation.url && URL.canParse(citation.url)) {
            const url = new URL(citation.url);
            if (["http:", "https:"].includes(url.protocol)) {
              citationMap.set(citation.url, citation.title ?? "");
            }
          }
        }
      }

      // Serper returns standard search results when Google does not trigger an overview.
      const hasAiAnswer = text.trim().length > 0;
      if (!hasAiAnswer) {
        text = "No Google AI Overview was triggered by Google for this query.";
      }

      const citations = Array.from(citationMap.entries()).map(([url, title]) => ({
        url,
        title,
      }));

      const modelVersion = request.model || "google-ai-overview-surface";

      return {
        status: "succeeded",
        text,
        modelVersion,
        latencyMs: Date.now() - start,
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
        },
        citations,
        searchQueries: [request.prompt],
        searchEntryPoint: null,
        grounded: citations.length > 0,
        raw,
        estimatedCostUsd: config.costPerCallUsd ?? null,
        refusalReason: null,
      } satisfies ProviderResult;
    },
  };
}
