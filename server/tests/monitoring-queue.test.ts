import { expect, it, vi } from "vitest";
import { monitoringRetryDelay } from "../src/services/monitoring/processor.js";
import { createCredentialPreflight } from "../src/services/monitoring/credential-preflight.js";

it("adds bounded jitter without retrying earlier than provider instructions", () => {
  expect(monitoringRetryDelay(1, 0, () => 0)).toBe(10);
  expect(monitoringRetryDelay(2, 0, () => 1)).toBe(25);
  expect(monitoringRetryDelay(3, 120, () => 1)).toBe(120);
  expect(monitoringRetryDelay(4, 0, () => 1)).toBe(100);
  expect(monitoringRetryDelay(10, 604800, () => 1)).toBe(604800);
});

it("single-flights metadata checks for a bulk batch and expires cached credentials", async () => {
  let now = 0;
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ models: [{ name: "models/gemini-3.8-flash" }] }),
    );
  const check = createCredentialPreflight(
    { gemini: { apiKey: "fixture-key", model: "gemini-3.8-flash" } },
    transport,
    { now: () => now, cacheMs: 1000 },
  );
  const results = await Promise.all(Array.from({ length: 50 }, () => check("gemini")));
  expect(results.every((result) => result.ok)).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(String(transport.mock.calls[0][0])).not.toContain("generateContent");
  now = 1001;
  await check("gemini");
  expect(transport).toHaveBeenCalledTimes(2);
});

it("distinguishes terminal credential rejection from temporary metadata outages", async () => {
  const denied = createCredentialPreflight(
    { openai: { apiKey: "fixture", model: "gpt-4o" } },
    vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 })),
  );
  expect(await denied("openai")).toMatchObject({
    ok: false,
    transient: false,
    code: "PROVIDER_HTTP_401",
  });
  const outage = createCredentialPreflight(
    { gemini: { apiKey: "fixture", model: "gemini-3.8-flash" } },
    vi.fn<typeof fetch>().mockRejectedValue(new Error("network secret")),
  );
  expect(await outage("gemini")).toMatchObject({ ok: false, transient: true });
  expect(await denied("openrouter")).toMatchObject({
    ok: false,
    transient: false,
    code: "ENGINE_NOT_CONFIGURED",
  });
  expect(
    await createCredentialPreflight({ serpApiKey: "fixture" })("google_ai_mode"),
  ).toMatchObject({ ok: false, verified: false, code: "ENGINE_NOT_CONFIGURED" });
});
