import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { GoogleSync } from "../src/services/integrations/google-sync.js";
import { TokenCrypto } from "../src/services/integrations/token-crypto.js";
import { runWithTenantContext } from "../src/db/tenant-query.js";
import { gscQuerySchema } from "../src/validations/integrations.validation.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const key = Buffer.alloc(32, 1);
function setup(response: unknown, status = 200) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM pg_roles"))
      return { rows: [{ rolsuper: false, rolbypassrls: false }], rowCount: 1 };
    if (sql.includes("FROM memberships")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("FOR UPDATE NOWAIT"))
      return {
        rows: [
          {
            property_id: "123456",
            encrypted_tokens: TokenCrypto.encrypt({ access_token: "secret" }, key),
          },
        ],
        rowCount: 1,
      };
    return { rows: [], rowCount: 0 };
  });
  const pool = { connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(response), { status }));
  const service = new GoogleSync(pool, key, {}, fetcher);
  const sync = (provider: "google_search_console" | "google_analytics_4") =>
    runWithTenantContext({ tenantId, userId }, () =>
      service.sync("project", tenantId, "connection", provider),
    );
  return { query, fetcher, sync, service };
}

describe("Live Google analytics imports", () => {
  it("does not interpret questionOnly=false as true", () => {
    expect(gscQuerySchema.parse({ questionOnly: "false" }).questionOnly).toBe(false);
    expect(gscQuerySchema.parse({ questionOnly: "true" }).questionOnly).toBe(true);
  });
  it("imports observed Search Console facts in one transaction", async () => {
    const { sync, query, fetcher } = setup({
      rows: [
        {
          keys: ["how to test", "https://example.com/", "2026-11-01", "MOBILE", "usa"],
          clicks: 4,
          impressions: 20,
          ctr: 0.2,
          position: 3,
        },
      ],
    });
    expect(await sync("google_search_console")).toMatchObject({
      syncedCount: 1,
      questionsCount: 1,
    });
    expect(fetcher.mock.calls[0][0]).toContain("www.googleapis.com/webmasters/v3/sites/");
    const sql = query.mock.calls.map(([q]) => q);
    expect(sql.some((q) => q.startsWith("DELETE FROM gsc_performance_facts"))).toBe(true);
    expect(sql.at(-1)).toBe("COMMIT");
  });
  it("classifies GA4 traffic and requests session-level sources", async () => {
    const { sync, fetcher } = setup({
      rowCount: 1,
      rows: [
        {
          dimensionValues: ["20261101", "chatgpt.com", "referral", "/pricing"].map((value) => ({
            value,
          })),
          metricValues: ["10", "8", "9", "2", "50", "20"].map((value) => ({ value })),
        },
      ],
    });
    expect(await sync("google_analytics_4")).toMatchObject({ totalSessions: 10, aiSessions: 10 });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.dimensions).toContainEqual({ name: "sessionSource" });
  });
  it("preserves existing facts when Google fails", async () => {
    const { sync, query } = setup({ error: "private provider message" }, 403);
    await expect(sync("google_search_console")).rejects.toMatchObject({
      code: "GOOGLE_SYNC_FAILED",
    });
    expect(query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });
  it("requires request tenant context before requesting credentials", async () => {
    const { service, fetcher } = setup({});
    await expect(
      service.sync("project", tenantId, "connection", "google_search_console"),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
