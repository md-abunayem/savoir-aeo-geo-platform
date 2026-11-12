import { describe, it, expect, vi } from "vitest";
import { createApiClient } from "../lib/api";
const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), { status: 200 });
const fail = (status: number, code: string) =>
  new Response(
    JSON.stringify({ code, detail: "Request rejected", requestId: "test-id" }),
    { status },
  );
describe("API transport", () => {
  it("allows provider tests to wait beyond the ordinary request timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ok({ status: "succeeded" }));
      await createApiClient(fetcher, () => "savoir_csrf=token").request("/v1/test", {
        method: "POST", timeoutMs: 75000,
      });
      expect(timeout).toHaveBeenCalledWith(75000);
    } finally {
      timeout.mockRestore();
    }
  });
  it("keeps credentials in cookies and includes CSRF on writes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok({ id: "created" }));
    const api = createApiClient(
      fetcher,
      () => "savoir_csrf=signed-token; another=value",
    );
    await api.request("/v1/prompts", {
      method: "POST",
      body: { body: "Question" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/prompts",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        headers: expect.objectContaining({ "X-CSRF-Token": "signed-token" }),
      }),
    );
  });
  it("serializes concurrent expired-session refresh requests", async () => {
    let renewed = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === "/v1/auth/refresh") {
        await new Promise((r) => setTimeout(r, 5));
        renewed = true;
        return ok(null);
      }
      return renewed ? ok({ value: "ready" }) : fail(401, "INVALID_SESSION");
    });
    const api = createApiClient(fetcher, () => "savoir_csrf=token");
    const results = await Promise.all([
      api.request("/v1/projects"),
      api.request("/v1/runs"),
      api.request("/v1/health"),
    ]);
    expect(results).toEqual(Array(3).fill({ value: "ready" }));
    expect(
      fetcher.mock.calls.filter(([url]) => url === "/v1/auth/refresh"),
    ).toHaveLength(1);
  });
  it("renews an invalid CSRF token once before retrying a rejected write", async () => {
    let writes = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, options) => {
        if (url === "/v1/auth/csrf") return ok({ csrfToken: "fresh" });
        writes++;
        if (writes === 1) return fail(403, "INVALID_CSRF");
        expect(options?.headers).toMatchObject({ "X-CSRF-Token": "fresh" });
        return ok(null);
      });
    await createApiClient(fetcher, () => "savoir_csrf=expired").request(
      "/v1/prompts",
      { method: "POST", body: {} },
    );
    expect(writes).toBe(2);
  });
  it("does not replay ambiguous writes or turn server errors into empty data", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("network"));
    await expect(
      createApiClient(fetcher, () => "savoir_csrf=token").request(
        "/v1/prompts",
        { method: "POST", body: {} },
      ),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const broken = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fail(503, "UNAVAILABLE"));
    await expect(
      createApiClient(broken).request("/v1/projects"),
    ).rejects.toMatchObject({
      status: 503,
      requestId: "test-id",
      message: "Request rejected",
    });
  });
  it("does not attempt a session refresh for invalid login credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fail(401, "INVALID_CREDENTIALS"));
    await expect(
      createApiClient(fetcher, () => "savoir_csrf=token").request(
        "/v1/auth/login",
        { method: "POST", auth: false, body: {} },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects non-API paths and malformed success envelopes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const api = createApiClient(fetcher);
    await expect(api.request("https://example.com")).rejects.toThrow(
      "API paths",
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(api.request("/v1/projects")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
