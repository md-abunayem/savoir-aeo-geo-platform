import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { ApiKeyService } from "../src/services/integrations/api-key.service.js";

describe("Public API key authentication", () => {
  it("hashes secrets before querying and enforces both rate limits", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          key_id: "key",
          tenant_id: "tenant",
          project_id: "project",
          user_id: "owner",
          rate_limit_rpm: 60,
        },
      ],
    });
    const consume = vi.fn().mockResolvedValue({ allowed: true, retryAfter: 1 });
    const service = new ApiKeyService({ query } as unknown as Pool, { consume });
    const secret = "sk_live_" + "a".repeat(48);
    expect(
      await service.authorize("Bearer " + secret, "project", "read:traffic", "127.0.0.1"),
    ).toEqual({ tenantId: "tenant", projectId: "project", userId: "owner" });
    expect(query.mock.calls[0][1][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(query.mock.calls)).not.toContain(secret);
    expect(consume).toHaveBeenCalledWith("public-api-key:key", 60, 60);
  });
  it("rejects invalid/revoked keys and fails closed when rate limiting fails", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const consume = vi.fn().mockResolvedValue({ allowed: true, retryAfter: 1 });
    const service = new ApiKeyService({ query } as unknown as Pool, { consume });
    await expect(
      service.authorize(undefined, "project", "read:traffic", "ip"),
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    expect(query).not.toHaveBeenCalled();
    await expect(
      service.authorize("Bearer sk_live_" + "b".repeat(48), "project", "read:traffic", "ip"),
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    consume.mockRejectedValue(new Error("Redis unavailable"));
    await expect(
      service.authorize("Bearer sk_live_" + "b".repeat(48), "project", "read:traffic", "ip"),
    ).rejects.toMatchObject({ statusCode: 429 });
  });
});
