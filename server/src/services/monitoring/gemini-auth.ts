/** Persist only known classifications, never provider messages or credential metadata. */
export function geminiAuthenticationError(status: number, reasons: unknown[]): string | null {
  if (![400, 401, 403].includes(status)) return null;
  if (reasons.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED")) return "PROVIDER_AUTH_TOKEN_UNSUPPORTED";
  if (
    reasons.some((reason) =>
      ["API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_NOT_FOUND"].includes(String(reason)),
    )
  )
    return "PROVIDER_API_KEY_INVALID";
  if (
    reasons.some((reason) =>
      [
        "API_KEY_SERVICE_BLOCKED",
        "API_KEY_HTTP_REFERRER_BLOCKED",
        "API_KEY_IP_ADDRESS_BLOCKED",
      ].includes(String(reason)),
    )
  )
    return "PROVIDER_API_KEY_RESTRICTED";
  return status === 401 ? "PROVIDER_HTTP_401" : null;
}

/** Read-only metadata probe: no generation, grounding, or monitoring credit reservation. */
export async function checkGeminiCredential(
  config: { apiKey: string; model: string; authenticationOnly?: boolean },
  transport: typeof fetch = fetch,
) {
  if (!config.apiKey.trim())
    return {
      ok: false,
      httpStatus: null,
      code: "ENGINE_NOT_CONFIGURED",
      configuredModelAvailable: null,
    };
  try {
    const response = await transport(
      config.authenticationOnly
        ? "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1"
        : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}`,
      {
        headers: { "x-goog-api-key": config.apiKey, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const body = ((await response.json().catch(() => ({}))) ?? {}) as {
      error?: { details?: { reason?: unknown }[] };
      name?: string;
      models?: unknown[];
    };
    if (!response.ok)
      return {
        ok: false,
        httpStatus: response.status,
        code:
          geminiAuthenticationError(
            response.status,
            (Array.isArray(body.error?.details) ? body.error.details : []).map(
              (detail) => detail?.reason,
            ),
          ) ?? (response.status === 404 ? "INVALID_MODEL" : `PROVIDER_HTTP_${response.status}`),
        configuredModelAvailable: null,
      };
    if (config.authenticationOnly && Array.isArray(body.models))
      return { ok: true, httpStatus: response.status, code: null, configuredModelAvailable: null };
    if (typeof body.name !== "string")
      return {
        ok: false,
        httpStatus: response.status,
        code: "PROVIDER_MALFORMED",
        configuredModelAvailable: null,
      };
    const available = body.name === `models/${config.model}`;
    return {
      ok: available,
      httpStatus: response.status,
      code: available ? null : "INVALID_MODEL",
      configuredModelAvailable: available,
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
