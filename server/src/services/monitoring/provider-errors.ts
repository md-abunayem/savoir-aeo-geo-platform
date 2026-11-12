/** Stable public categories and actionable messages; never echo provider error bodies. */
export function providerFailure(code: string) {
  let category = "PROVIDER_UNAVAILABLE";
  let message = "The selected provider is unavailable. Inspect monitoring status before retrying.";
  if (/API_KEY_INVALID|AUTH_TOKEN|HTTP_401/.test(code)) {
    category = "AUTHENTICATION_ERROR";
    message =
      "The selected provider rejected its credential. Check the server key and restart API and worker.";
  } else if (/RESTRICTED|HTTP_403/.test(code)) {
    category = "PERMISSION_DENIED";
    message = "Check API key restrictions, account permissions, region and model access.";
  } else if (/GROUNDING_QUOTA/.test(code)) {
    category = "GROUNDING_QUOTA_EXHAUSTED";
    message =
      "Google Search grounding quota is exhausted. Check AI Studio usage and billing; explicitly resume after resolution.";
  } else if (/QUOTA|HTTP_402/.test(code)) {
    category = "QUOTA_EXHAUSTED";
    message =
      "The selected provider quota or credits are exhausted. Check its usage limits before explicitly resuming.";
  } else if (/RATE_LIMIT/.test(code)) {
    category = "RATE_LIMIT_EXCEEDED";
    message =
      "The selected provider rate limit was reached. Bounded retries respect its retry delay.";
  } else if (/CAPACITY/.test(code)) {
    category = "PROVIDER_CAPACITY_EXCEEDED";
    message = "The selected model has no available capacity. Retry later using the same model.";
  } else if (/TIMEOUT|HTTP_408|HTTP_504/.test(code)) {
    category = "PROVIDER_TIMEOUT";
    message = "The provider timed out. An uncertain request is not automatically repeated.";
  } else if (/INVALID_MODEL|HTTP_404/.test(code)) {
    category = "MODEL_UNAVAILABLE";
    message =
      "The selected model is unavailable to this account. Verify its exact identifier and access.";
  } else if (/MALFORMED|EMPTY_ANSWER|INCOMPLETE_ANSWER/.test(code)) {
    category = "INVALID_PROVIDER_RESPONSE";
    message = "The selected provider returned an invalid or incomplete answer.";
  } else if (/NOT_CONFIGURED|HTTP_400|HTTP_422/.test(code)) {
    category = "PROVIDER_CONFIGURATION_ERROR";
    message =
      "Check the selected provider key, model and requested tool support. No fallback was attempted.";
  }
  return { category, message };
}
