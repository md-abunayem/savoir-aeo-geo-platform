import { checkGeminiCredential } from "./gemini-auth.js";
import { checkOpenRouterCredential } from "./openrouter.adapter.js";
import type { MonitoringEngineType } from "./types.js";

export interface CredentialCheck {
  ok: boolean;
  code: string | null;
  transient: boolean;
  verified?: boolean;
}
type Credential = { apiKey: string; model: string };

/** Single-flight metadata checks per engine; no generation or paid search checks. */
export function createCredentialPreflight(
  config: {
    gemini?: Credential;
    openrouter?: Credential;
    openai?: Credential;
    serpApiKey?: string;
  },
  transport: typeof fetch = fetch,
  options: { cacheMs?: number; now?: () => number } = {},
) {
  const cache = new Map<string, { until: number; pending: Promise<CredentialCheck> }>();
  const now = options.now ?? Date.now;
  async function inspect(engine: MonitoringEngineType): Promise<CredentialCheck> {
    if (engine.startsWith("google_ai_")) {
      if (engine === "google_ai_mode")
        return { ok: false, code: "ENGINE_NOT_CONFIGURED", transient: false, verified: false };

      // Licensed SERP adapters have no common metadata authentication endpoint.
      return {
        ok: Boolean(config.serpApiKey),
        code: config.serpApiKey ? null : "ENGINE_NOT_CONFIGURED",
        transient: false,
        verified: false,
      };
    }
    const credential =
      engine === "gemini"
        ? config.gemini
        : engine === "openrouter"
          ? config.openrouter
          : config.openai;
    if (!credential?.apiKey) return { ok: false, code: "ENGINE_NOT_CONFIGURED", transient: false };
    try {
      let result: { ok: boolean; code: string | null; httpStatus: number | null };
      if (engine === "gemini")
        result = await checkGeminiCredential(
          { ...credential, authenticationOnly: true },
          transport,
        );
      else if (engine === "openrouter")
        result = await checkOpenRouterCredential(
          { ...credential, authenticationOnly: true },
          transport,
        );
      else {
        const response = await transport(
          `https://api.openai.com/v1/models/${encodeURIComponent(credential.model)}`,
          {
            headers: { Authorization: `Bearer ${credential.apiKey}` },
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          },
        );
        await response.body?.cancel();
        result = {
          ok: response.ok,
          httpStatus: response.status,
          code: response.ok
            ? null
            : response.status === 404
              ? "INVALID_MODEL"
              : `PROVIDER_HTTP_${response.status}`,
        };
      }
      const terminal = [
        "ENGINE_NOT_CONFIGURED",
        "PROVIDER_HTTP_401",
        "PROVIDER_HTTP_403",
        "PROVIDER_AUTH_TOKEN_UNSUPPORTED",
        "PROVIDER_API_KEY_INVALID",
        "PROVIDER_API_KEY_RESTRICTED",
        "INVALID_MODEL",
      ];
      return {
        ok: result.ok,
        code: result.code,
        transient: !result.ok && !terminal.includes(result.code ?? ""),
        verified: result.ok,
      };
    } catch {
      return { ok: false, code: "PROVIDER_PREFLIGHT_UNAVAILABLE", transient: true };
    }
  }
  return (engine: MonitoringEngineType): Promise<CredentialCheck> => {
    const prior = cache.get(engine);
    if (prior && prior.until > now()) return prior.pending;
    const pending = inspect(engine);
    const entry = { until: now() + (options.cacheMs ?? 300000), pending };
    cache.set(engine, entry);
    void pending.then((result) => {
      entry.until =
        now() +
        (result.ok ? (options.cacheMs ?? 300000) : Math.min(options.cacheMs ?? 300000, 30000));
    });
    return pending;
  };
}
