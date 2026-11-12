import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentStudioService } from "../src/services/content/content-studio.service.js";
import { contentLeaves } from "../src/services/content/content-studio.schema.js";
import {
  brand,
  brandId,
  product,
  productId,
  projectId,
  studioDocument,
} from "./studio-fixtures.js";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generate };
  },
}));
function setup() {
  const memory = {
    searchRelevantFacts: vi.fn().mockResolvedValue([{ ...product, similarity: 0.9 }]),
    getApprovedBrandRules: vi.fn().mockResolvedValue([brand]),
    getApprovedProductFacts: vi.fn().mockResolvedValue([product]),
  };
  const checker = {
    check: vi.fn().mockResolvedValue({ passed: true, flaggedClaims: [], suggestions: [] }),
  };
  const input = {
    topic: "Reporting",
    question: "How can we improve reporting?",
    intent: "educational" as const,
    brief: "Draft a practical guide; unsupported claims must be omitted.",
  };
  return {
    memory,
    checker,
    input,
    service: new ContentStudioService(
      memory,
      { apiKey: "test", model: "configured-model" },
      checker,
    ),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.generate.mockResolvedValue({ text: JSON.stringify(studioDocument()) });
});

describe("multi-format content studio", () => {
  it("runs generation and fact checking as separate model calls with fresh evidence", async () => {
    const { memory, input } = setup();
    const document = studioDocument();
    document.content.facebook.caption = "Starter costs USD 9/month.";
    mocks.generate.mockResolvedValueOnce({ text: JSON.stringify(document) }).mockResolvedValueOnce({
      text: JSON.stringify({
        assessments: contentLeaves(document).map(({ path }) => ({
          path,
          claims:
            path === "content.facebook.caption"
              ? [
                  {
                    claim: "USD 9/month",
                    verdict: "contradicted",
                    evidence_ids: [productId],
                    reason: "Approved price is USD 29/month.",
                  },
                ]
              : [],
        })),
      }),
    });
    const service = new ContentStudioService(memory, { apiKey: "test", model: "configured-model" });
    const result = await service.generate(projectId, input);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(memory.getApprovedProductFacts).toHaveBeenCalledWith(projectId);
    expect(result.validation.passed).toBe(false);
    expect(result.validation.flaggedClaims[0]?.code).toBe("CONTRADICTED_CLAIM");
  });
  it("generates the blueprint, grounds on product facts and all brand rules, then verifies independently", async () => {
    const { service, input, memory, checker } = setup();
    const result = await service.generate(projectId, input);
    expect(Object.keys(result.document.content)).toEqual([
      "facebook",
      "instagram",
      "x",
      "short_video",
      "podcast",
      "blog",
    ]);
    expect(memory.searchRelevantFacts).toHaveBeenCalledWith(
      projectId,
      "Reporting\nHow can we improve reporting?",
      0.7,
    );
    expect(memory.getApprovedBrandRules).toHaveBeenCalledWith(projectId);
    const prompt = mocks.generate.mock.calls[0]![0];
    expect(prompt.model).toBe("configured-model");
    expect(prompt.config.systemInstruction).toContain(
      "Only mention features and pricing explicitly confirmed in the provided Product Facts. If unconfirmed, omit or flag.",
    );
    expect(prompt.config.systemInstruction).toContain("USD 29/month");
    expect(prompt.config.systemInstruction).toContain("guaranteed");
    expect(prompt.config.systemInstruction).toContain("not factual authority");
    expect(prompt.config.responseJsonSchema.required).toContain("content");
    expect(checker.check).toHaveBeenCalledWith(result.document, { productFactIds: [productId] });
    expect(result.evidence).toEqual({ productFactIds: [productId], brandRuleIds: [brandId] });
    expect(result.validation.passed).toBe(true);
  });

  it("returns a failed report with the draft instead of treating flagged content as verified", async () => {
    const { service, input, checker } = setup();
    checker.check.mockResolvedValue({
      passed: false,
      flaggedClaims: [],
      suggestions: ["Revise pricing."],
    });
    const result = await service.generate(projectId, input);
    expect(result.validation).toMatchObject({ passed: false, suggestions: ["Revise pricing."] });
    expect(result.document).toBeDefined();
  });

  it.each([
    "not json",
    JSON.stringify({ ...studioDocument(), extra: "unexpected" }),
    JSON.stringify({ ...studioDocument(), brand_id: productId }),
    JSON.stringify({ ...studioDocument(), intent: "decision" }),
  ])("rejects malformed output or changed metadata", async (text) => {
    const { service, input, checker } = setup();
    mocks.generate.mockResolvedValue({ text });
    await expect(service.generate(projectId, input)).rejects.toMatchObject({
      code: "STUDIO_GENERATION_FAILED",
    });
    expect(checker.check).not.toHaveBeenCalled();
  });

  it("does not call generation after unauthorized retrieval or embedding failure", async () => {
    const { service, input, memory } = setup();
    memory.searchRelevantFacts.mockRejectedValue(new Error("Unauthorized retrieval"));
    await expect(service.generate(projectId, input)).rejects.toThrow("Unauthorized retrieval");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("keeps all brand rules even with no product search matches", async () => {
    const { service, input, memory, checker } = setup();
    memory.searchRelevantFacts.mockResolvedValue([]);
    const result = await service.generate(projectId, input);
    expect(mocks.generate.mock.calls[0]![0].config.systemInstruction).toContain(
      '"productFacts":[]',
    );
    expect(mocks.generate.mock.calls[0]![0].config.systemInstruction).toContain("guaranteed");
    expect(checker.check).toHaveBeenCalledWith(result.document, { productFactIds: [] });
  });

  it("rejects oversized grounding without silently dropping brand rules", async () => {
    const { service, input, memory } = setup();
    memory.getApprovedBrandRules.mockResolvedValue([
      { ...brand, facts: { brandVoice: "x".repeat(100001) } },
    ]);
    await expect(service.generate(projectId, input)).rejects.toMatchObject({
      code: "STUDIO_CONTEXT_TOO_LARGE",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("validates input and reports missing provider configuration", async () => {
    const { service, input, memory } = setup();
    await expect(service.generate(projectId, { ...input, brief: "" })).rejects.toThrow();
    await expect(
      new ContentStudioService(memory, { model: "test" }).generate(projectId, input),
    ).rejects.toMatchObject({ code: "STUDIO_NOT_CONFIGURED" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
