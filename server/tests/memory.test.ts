import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { MemoryService } from "../src/services/memory/memory.service.js";

const mocks = vi.hoisted(() => ({ embed: vi.fn(), query: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { embedContent: mocks.embed };
  },
}));
vi.mock("../src/db/tenant.js", () => ({
  withTenant: async (_pool: unknown, _context: unknown, operation: (db: unknown) => unknown) =>
    operation(drizzle({ client: { query: mocks.query } as unknown as Pool })),
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const memoryId = "33333333-3333-4333-8333-333333333333";
const vector = Array.from({ length: 768 }, () => 0.1);
const service = () => new MemoryService({} as Pool, { userId: memoryId, tenantId }, "test");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.embed.mockResolvedValue({ embeddings: [{ values: vector }] });
  mocks.query.mockResolvedValueOnce({ rows: [[projectId]] });
});

describe("marketing memory", () => {
  it("loads mandatory brand rules with tenant/project approval filters and no similarity cutoff", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [[memoryId, "Plain", [], [], ["guaranteed"], []]] });
    const rules = await service().getApprovedBrandRules(projectId);
    expect(rules[0]).toMatchObject({
      id: memoryId,
      kind: "brand",
      facts: { negativeKeywords: ["guaranteed"] },
    });
    const [query, parameters] = mocks.query.mock.calls[1]!;
    expect(query.text).toContain('"brand_memory"."approval_status"');
    expect(query.text).not.toContain("<=>");
    expect(parameters).toEqual([projectId, tenantId, "approved"]);
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("reloads current product facts with validity and tenant boundaries for independent review", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [[memoryId, "Starter", ["Reports"], {}, "USD 29/month", null, null]],
    });
    expect((await service().getApprovedProductFacts(projectId))[0]).toMatchObject({
      id: memoryId,
      kind: "product",
      facts: { pricing: "USD 29/month" },
    });
    const [query, parameters] = mocks.query.mock.calls[1]!;
    expect(query.text).toContain('"valid_from" <= now()');
    expect(query.text).toContain('"valid_until" > now()');
    expect(parameters).toEqual([projectId, tenantId, "approved"]);
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it("embeds brand rules on create and stores facts and vector in one insert", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [[memoryId]] });
    await expect(
      service().saveBrandMemory(projectId, {
        brandVoice: "Clear and factual",
        negativeClaims: ["Guaranteed results"],
      }),
    ).resolves.toEqual({ id: memoryId });
    expect(mocks.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "text-embedding-004",
        contents: expect.stringContaining("Guaranteed results"),
        config: expect.objectContaining({
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: 768,
        }),
      }),
    );
    expect(mocks.query.mock.calls[1]?.[0].text).toContain('insert into "brand_memory"');
    expect(mocks.query.mock.calls[1]?.[1]).toContain(JSON.stringify(vector));
  });

  it("re-embeds updated product facts and scopes the update by memory, project and tenant", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [[memoryId]] });
    await service().saveProductMemory(
      projectId,
      {
        name: "Starter",
        pricing: "USD 19/month",
        approvalStatus: "approved",
      },
      memoryId,
    );
    expect(mocks.embed.mock.calls[0]?.[0].contents).toContain("USD 19/month");
    const [query, parameters] = mocks.query.mock.calls[1]!;
    expect(query.text).toContain('update "product_memory"');
    expect(parameters).toEqual(
      expect.arrayContaining([memoryId, projectId, tenantId, JSON.stringify(vector)]),
    );
  });

  it("fails without writing when embeddings are malformed", async () => {
    mocks.embed.mockResolvedValue({ embeddings: [{ values: [0.1] }] });
    await expect(
      service().saveBrandMemory(projectId, { brandVoice: "Plain" }),
    ).rejects.toMatchObject({ code: "MEMORY_EMBEDDING_INVALID" });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("leaves existing facts untouched when the embedding provider fails", async () => {
    mocks.embed.mockRejectedValue(new Error("Provider unavailable"));
    await expect(
      service().saveProductMemory(
        projectId,
        {
          name: "Starter",
          pricing: "USD 29/month",
        },
        memoryId,
      ),
    ).rejects.toThrow("Provider unavailable");
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("does not insert a record when an update target is missing", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      service().saveBrandMemory(projectId, { brandVoice: "Plain" }, memoryId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[1]?.[0].text).toContain('update "brand_memory"');
  });

  it("does not send facts to Gemini for an inaccessible project", async () => {
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    await expect(
      service().saveBrandMemory(projectId, { brandVoice: "Private" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("retrieves both memory types using approved, tenant-scoped and valid facts", async () => {
    const fact = { id: memoryId, kind: "product", facts: { name: "Starter" }, similarity: 0.9 };
    mocks.query.mockResolvedValueOnce({ rows: [fact] });
    await expect(service().searchRelevantFacts(projectId, "Starter price", 0.8)).resolves.toEqual([
      fact,
    ]);
    expect(mocks.embed.mock.calls[0]?.[0].config.taskType).toBe("RETRIEVAL_QUERY");
    const [query, parameters] = mocks.query.mock.calls[1]!;
    expect(query.text).toContain("embedding <=>");
    expect(query.text.match(/approval_status = 'approved'/g)).toHaveLength(2);
    expect(query.text).toContain("valid_from <= now()");
    expect(query.text).toContain("valid_until > now()");
    expect(query.text).toContain("ORDER BY distance");
    expect(parameters).toEqual(expect.arrayContaining([projectId, tenantId]));
    expect(parameters.at(-1)).toBeCloseTo(0.2);
  });

  it("rejects invalid validity dates and search thresholds before embedding", async () => {
    await expect(
      service().saveProductMemory(projectId, {
        name: "Sale",
        pricing: "$10",
        validFrom: new Date("2026-11-11"),
        validUntil: new Date("2026-11-10"),
      }),
    ).rejects.toThrow();
    await expect(service().searchRelevantFacts(projectId, "price", 2)).rejects.toThrow();
    await expect(service().searchRelevantFacts(projectId, " ")).rejects.toThrow();
    expect(mocks.embed).not.toHaveBeenCalled();
  });
});
