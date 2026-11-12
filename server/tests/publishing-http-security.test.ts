import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicHttpsRequest } from "../src/services/publishing/public-http.js";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ default: { lookup: mocks.lookup } }));
vi.mock("node:https", () => ({ default: { request: mocks.request } }));
beforeEach(() => vi.resetAllMocks());
describe("CMS credential-bearing HTTPS transport", () => {
  it.each([
    "http://public.example",
    "https://user:password@public.example",
    "https://public.example:8443",
  ])("rejects unsafe URLs before sending credentials: %s", async (url) => {
    await expect(
      publicHttpsRequest(new URL(url), { headers: { Authorization: "secret" } }),
    ).rejects.toMatchObject({ code: "INVALID_PUBLIC_URL" });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:7f00:1", "fd00::1"])(
    "blocks private and mapped destinations: %s",
    async (address) => {
      mocks.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
      await expect(
        publicHttpsRequest(new URL("https://public.example"), {
          headers: { Authorization: "secret" },
        }),
      ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS_BLOCKED" });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it("pins the checked DNS IP while retaining TLS hostname verification", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mocks.request.mockImplementation((_url, _options, handler: (value: unknown) => void) => {
      const response = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: { "content-type": "application/json" },
      });
      handler(response);
      return {
        setTimeout: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
        end: () => {
          response.emit("data", Buffer.from('{"ok":true}'));
          response.emit("end");
        },
      };
    });
    const response = await publicHttpsRequest(new URL("https://cms.example/wp-json"), {
      headers: { Authorization: "secret" },
    });
    expect(await response.json()).toEqual({ ok: true });
    const [url, options] = mocks.request.mock.calls[0]!;
    expect(url.hostname).toBe("cms.example");
    const callback = vi.fn();
    options.lookup("cms.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(options.rejectUnauthorized).not.toBe(false);
  });
});
