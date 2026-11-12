import { expect, it } from "vitest";
import {
  engineStatusLabel,
  groundingStatusLabel,
  providerError,
  providerErrorSummary,
  runGroundingLabel,
} from "../lib/provider-status";

it("keeps credential configuration distinct from observed engine outcomes", () => {
  expect(engineStatusLabel(false, "succeeded")).toBe("Not configured");
  expect(engineStatusLabel(true, null)).toBe("Configured, not tested");
  expect(engineStatusLabel(true, "succeeded")).toBe(
    "Last observed request succeeded",
  );
  expect(engineStatusLabel(true, "failed")).toBe(
    "Last observed request failed",
  );
  expect(engineStatusLabel(true, "uncertain")).toBe("Last request outcome is uncertain");
  expect(engineStatusLabel(true, "refused")).toBe("Last observed request was refused");
});

it("explains stopped quota retries without inventing billing failures", () => {
  expect(providerError("PROVIDER_QUOTA_REVIEW_REQUIRED")).toContain("Automatic retries stopped");
  expect(providerError("PROVIDER_QUOTA_UNAVAILABLE")).toContain("quota limit of zero");
  expect(providerError("PROVIDER_RATE_LIMITED_RETRYABLE")).toContain("bounded backoff");
  expect(providerErrorSummary("PROVIDER_QUOTA_REVIEW_REQUIRED")).toBe("Quota review required. Automatic retries stopped.");
});

it("explains 403 access refusals and avoids claiming every 429 is a billing issue", () => {
  expect(providerError("PROVIDER_HTTP_403")).toContain(
    "credentials, permissions, the configured endpoint",
  );
  const limited = providerError("PROVIDER_RATE_LIMITED");
  expect(limited).toContain("quota or rate limit");
  expect(limited).toContain("Billing is not necessarily the cause");
  expect(providerError("PROVIDER_GROUNDING_QUOTA_EXHAUSTED")).toContain(
    "Search grounding quota",
  );
});

it("explains historical 401 failures and Google's specific authentication rejection", () => {
  expect(providerError("PROVIDER_HTTP_401")).toContain("rejected the configured credential");
  expect(providerError("PROVIDER_AUTH_TOKEN_UNSUPPORTED")).toContain("token type is unsupported");
  expect(providerError("PROVIDER_AUTH_TOKEN_UNSUPPORTED")).toContain("Google AI Studio");
  expect(providerError("PROVIDER_API_KEY_INVALID")).toContain("invalid, expired, or missing");
  expect(providerError("PROVIDER_API_KEY_RESTRICTED")).toContain("restrictions");
});

it("labels grounding from evidence and keeps missing historical evidence unknown", () => {
  expect(groundingStatusLabel("grounded")).toBe("Search grounded");
  expect(groundingStatusLabel("no_sources")).toBe(
    "No grounding sources returned",
  );
  expect(groundingStatusLabel("unknown")).toBe("Grounding status unknown");
  expect(runGroundingLabel({})).toBe("Grounding status unknown");
  expect(runGroundingLabel({ citations: [{ url: "https://example.com" }] })).toBe("Grounding status unknown");
  expect(runGroundingLabel({ grounded: false, citations: [] })).toBe("No grounding sources returned");
  expect(runGroundingLabel({ grounded: true, citations: [{ url: "https://example.com" }] })).toBe("Search grounded");
});
