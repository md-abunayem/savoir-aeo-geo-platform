export function providerError(code: string | null, engine?: string) {
  switch (code) {
    case "PROVIDER_PREFLIGHT_UNAVAILABLE":
      return "The worker is waiting for the provider's credential check to recover. No generation request has been made for this attempt. The queue will check again automatically.";
    case "PROVIDER_HTTP_401":
      return "The provider rejected the configured credential (HTTP 401). Verify the API key for this provider and endpoint, then restart the API and monitoring worker. Changing the model or adding quota will not resolve an authentication rejection.";
    case "PROVIDER_AUTH_TOKEN_UNSUPPORTED":
      return "Google rejected the Gemini credential because its token type is unsupported. Verify the complete key in Google AI Studio and its Gemini Developer API access; replace or repair the credential, then restart the API and monitoring worker. This does not mean the model is unavailable.";
    case "PROVIDER_API_KEY_INVALID":
      return "Google reported an invalid, expired, or missing API key. Update GEMINI_API_KEY in the server environment, then restart the API and monitoring worker.";
    case "PROVIDER_API_KEY_RESTRICTED":
      return "Google blocked this API key under its service or application restrictions. Check that the key permits the Gemini Developer API and requests from this backend.";
    case "PROVIDER_METADATA_CHECK_FAILED":
      return "The read-only provider check could not finish. Check network access and retry the credential check before running a collection.";
    case "CONNECTION_TEST_UNCONFIRMED":
      return "This test is still running or its final outcome could not be saved. Checking the same test again will not send another provider request.";
    case "PROVIDER_HTTP_403":
      return "The provider refused access (HTTP 403). Check credentials, permissions, the configured endpoint, and whether this engine is supported.";
    case "PROVIDER_GROUNDING_QUOTA_EXHAUSTED":
      return "The provider identified a Search grounding quota rejection. Check the provider's grounding limits and reset information.";
    case "PROVIDER_DAILY_QUOTA_EXHAUSTED":
      return "The provider identified a daily quota rejection. Check its limits and reset time.";
    case "PROVIDER_RATE_LIMITED":
      return "The provider rejected the request for a quota or rate limit (HTTP 429). It may be a request, token, or service limit; the response did not identify which one. Billing is not necessarily the cause.";
    case "PROVIDER_RATE_LIMITED_RETRYABLE":
      return "The provider temporarily limited this request (HTTP 429). The worker waits for the provider's retry delay or uses bounded backoff before retrying.";
    case "PROVIDER_QUOTA_UNAVAILABLE":
      return "Google reported a quota limit of zero for this request. Automatic retries stopped. Check this model's quota and access in Google AI Studio before starting a new collection.";
    case "PROVIDER_QUOTA_REVIEW_REQUIRED":
      if (engine === "openrouter") return "OpenRouter rejected this request with HTTP 429. Check OpenRouter limits before trying again. No alternate provider is used; web-search fees may apply separately.";
      return "The provider rejected this request with HTTP 429 without a usable retry time. Automatic retries stopped. Review the model and Search grounding quotas before starting a new collection.";
    case "PROVIDER_HTTP_404":
    case "INVALID_MODEL":
      return "This model or engine is unavailable at the configured provider endpoint. Check the supported model list and endpoint.";
    case "PROVIDER_NETWORK_UNCERTAIN":
      return "The connection ended before Savoir could confirm the provider's response. The provider may have processed the request; it was not automatically retried.";
    case "EVIDENCE_WRITE_UNCERTAIN":
      return "The provider response was received, but Savoir could not confirm that its evidence was saved. No new provider request was made automatically.";
    case "PROVIDER_MALFORMED":
    case "PROVIDER_EMPTY_ANSWER":
    case "PROVIDER_INCOMPLETE_ANSWER":
    case "PROVIDER_UNEXPECTED":
      return "The provider request completed with an unusable response. Review the technical code before trying again.";
    default:
      return code
        ? "The request could not be completed. Review the technical code for details."
        : "No provider error was reported.";
  }
}

export function providerErrorSummary(code: string) {
  if (code === "PROVIDER_PREFLIGHT_UNAVAILABLE") return "Waiting for provider credential check.";
  if (code === "PROVIDER_QUOTA_REVIEW_REQUIRED") return "Quota review required. Automatic retries stopped.";
  if (code === "PROVIDER_QUOTA_UNAVAILABLE") return "No quota available for this request.";
  if (["PROVIDER_RATE_LIMITED", "PROVIDER_RATE_LIMITED_RETRYABLE"].includes(code)) return "Provider rate or quota limit reached.";
  if (["PROVIDER_HTTP_401", "PROVIDER_AUTH_TOKEN_UNSUPPORTED", "PROVIDER_API_KEY_INVALID"].includes(code)) return "Provider authentication rejected.";
  return "Provider request failed. Open error details for guidance.";
}

export function providerHelpLinks(engine: string) {
  if (engine === "openrouter") return [
    { label: "OpenRouter limits", href: "https://openrouter.ai/docs/api-reference/limits" },
    { label: "OpenRouter API keys", href: "https://openrouter.ai/settings/keys" },
  ];
  if (engine !== "gemini") return [];
  return [
    {
      label: "Gemini API troubleshooting",
      href: "https://ai.google.dev/gemini-api/docs/troubleshooting",
    },
    {
      label: "Gemini API rate limits",
      href: "https://ai.google.dev/gemini-api/docs/rate-limits",
    },
    {
      label: "Gemini API keys",
      href: "https://ai.google.dev/gemini-api/docs/api-key",
    },
  ];
}

export function engineStatusLabel(
  configured: boolean,
  observation: "succeeded" | "failed" | "refused" | "uncertain" | null | undefined,
) {
  if (!configured) return "Not configured";
  if (observation === "succeeded") return "Last observed request succeeded";
  if (observation === "failed") return "Last observed request failed";
  if (observation === "refused") return "Last observed request was refused";
  if (observation === "uncertain") return "Last request outcome is uncertain";
  return "Configured, not tested";
}

export function groundingStatusLabel(
  status: "grounded" | "no_sources" | "ungrounded_mode" | "unknown" | undefined,
) {
  if (status === "grounded") return "Search grounded";
  if (status === "no_sources") return "No grounding sources returned";
  if (status === "ungrounded_mode") return "Ungrounded mode";
  return "Grounding status unknown";
}

export function runGroundingLabel(
  result: { grounded?: boolean; citations?: unknown[] } | null,
) {
  if (typeof result?.grounded !== "boolean")
    return groundingStatusLabel("unknown");
  return groundingStatusLabel(
    result.grounded && result.citations?.length ? "grounded" : "no_sources",
  );
}
