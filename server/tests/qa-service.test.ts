import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { QaService } from "../src/services/intelligence/qa.service.js";

const mocks = vi.hoisted(() => ({ tenantQuery: vi.fn(), transaction: vi.fn() }));
vi.mock("../src/db/tenant.js", () => ({
  withTenantClient: async (
    _pool: unknown,
    context: unknown,
    operation: (client: unknown) => unknown,
  ) => {
    mocks.transaction(context);
    return operation({ query: mocks.tenantQuery });
  },
}));
const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const tenantId = "33333333-3333-4333-8333-333333333333";
function setup() {
  const query = vi.fn().mockResolvedValue({ rows: [{ tenant_id: tenantId }] });
  const classify = vi.fn().mockImplementation(async (questions: string[]) =>
    questions.map(() => ({
      intent: "decision",
      recommendedFormats: ["Case Study", "Demo Script"],
    })),
  );
  return { query, classify, service: new QaService({ query } as unknown as Pool, { classify }) };
}
const row = {
  id: "question",
  source: "faq",
  questionText: "Can I get a demo?",
  intent: "decision",
  demandScore: 90,
  businessPriority: 80,
  priorityScore: 86,
  status: "backlog",
};
beforeEach(() => vi.resetAllMocks());

describe("Q&A backlog service", () => {
  it("deduplicates normalized questions and persists classifications atomically", async () => {
    const { service, classify } = setup();
    mocks.tenantQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [row] });
    const result = await service.ingest(userId, projectId, {
      questions: [
        { source: "faq", questionText: "Can I get a demo?", businessPriority: 80 },
        { source: "faq", questionText: "CAN I  get a demo?", businessPriority: 90 },
      ],
    });
    expect(result).toMatchObject({ received: 2, imported: 1, duplicates: 1 });
    expect(classify).toHaveBeenCalledWith(["Can I get a demo?"]);
    expect(mocks.transaction).toHaveBeenCalledWith({ userId, tenantId });
    const [sql, params] = mocks.tenantQuery.mock.calls[1]!;
    expect(sql).toContain("ON CONFLICT (project_id, source, question_hash) DO NOTHING");
    expect(params.slice(0, 2)).toEqual([tenantId, projectId]);
    expect(JSON.parse(params[2])[0]).toMatchObject({
      demand_score: 2,
      business_priority: 90,
      intent: "decision",
    });
  });

  it("skips previously imported questions without calling the classifier", async () => {
    const { service, classify } = setup();
    mocks.tenantQuery.mockResolvedValueOnce({
      rows: [
        { source: "faq", question_hash: createHash("sha256").update("what is aeo?").digest("hex") },
      ],
    });
    expect(
      await service.ingest(userId, projectId, [{ source: "faq", questionText: "What is AEO?" }]),
    ).toEqual({ received: 1, imported: 0, duplicates: 1, questions: [] });
    expect(classify).not.toHaveBeenCalled();
    expect(mocks.tenantQuery).toHaveBeenCalledTimes(1);
  });

  it("does not write when any classification fails", async () => {
    const { service, classify } = setup();
    mocks.tenantQuery.mockResolvedValue({ rows: [] });
    classify.mockRejectedValue(new Error("Failed classification"));
    await expect(
      service.ingest(userId, projectId, [{ source: "faq", questionText: "What is AEO?" }]),
    ).rejects.toThrow();
    expect(mocks.tenantQuery).toHaveBeenCalledTimes(1);
  });

  it("denies unauthorized projects before reading questions or calling Gemini", async () => {
    const { service, query, classify } = setup();
    query.mockResolvedValue({ rows: [{ tenant_id: null }] });
    await expect(
      service.ingest(userId, projectId, [{ source: "faq", questionText: "What is AEO?" }]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(query).toHaveBeenCalledWith("SELECT savoir_project_context($1,$2) AS tenant_id", [
      userId,
      projectId,
    ]);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    await expect(service.opportunities(userId, projectId, {})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("preserves supplied scores and separates different question sources", async () => {
    const { service, classify } = setup();
    mocks.tenantQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row, row] });
    await service.ingest(userId, projectId, [
      { source: "faq", questionText: "What is AEO?", demandScore: 0, businessPriority: 0 },
      { source: "survey", questionText: "What is AEO?", demandScore: 100 },
    ]);
    expect(classify).toHaveBeenCalledWith(["What is AEO?", "What is AEO?"]);
    expect(JSON.parse(mocks.tenantQuery.mock.calls[1]![1][2])).toEqual([
      expect.objectContaining({ demand_score: 0, business_priority: 0, source: "faq" }),
      expect.objectContaining({ demand_score: 100, business_priority: 50, source: "survey" }),
    ]);
  });

  it("returns a filtered, prioritized backlog with pagination and content formats", async () => {
    const { service } = setup();
    mocks.tenantQuery.mockResolvedValue({ rows: [row, { ...row, id: "second" }] });
    const result = await service.opportunities(userId, projectId, {
      intent: "decision",
      source: "faq",
      limit: 1,
      offset: 5,
    });
    expect(result).toMatchObject({
      nextOffset: 6,
      questions: [{ id: "question", recommendedFormats: ["Case Study", "Demo Script"] }],
    });
    const [sql, params] = mocks.tenantQuery.mock.calls[0]!;
    expect(params).toEqual([tenantId, projectId, "backlog", "decision", "faq", 2, 5]);
    expect(sql).toContain(
      'ORDER BY "priorityScore" DESC, demand_score DESC, created_at ASC, id ASC',
    );
    expect(sql).toContain("6 * demand_score + 4 * business_priority");
  });
});
