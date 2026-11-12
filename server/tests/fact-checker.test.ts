import { beforeEach, describe, expect, it, vi } from "vitest";
import { FactCheckerService } from "../src/services/content/fact-checker.service.js";
import { contentLeaves } from "../src/services/content/content-studio.schema.js";
import { brand, product, productId, projectId, studioDocument } from "./studio-fixtures.js";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generate };
  },
}));
function setup() {
  const memory = {
    getApprovedBrandRules: vi.fn().mockResolvedValue([brand]),
    getApprovedProductFacts: vi.fn().mockResolvedValue([product]),
  };
  return {
    memory,
    checker: new FactCheckerService(memory, { apiKey: "test", model: "review-model" }),
  };
}
const review = (document: ReturnType<typeof studioDocument>) => ({
  assessments: contentLeaves(document).map(({ path }) => ({
    path,
    claims: [] as Array<{ claim: string; verdict: string; evidence_ids: string[]; reason: string }>,
  })),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.generate.mockImplementation(async ({ contents }: { contents: string }) => ({
    text: JSON.stringify({
      assessments: JSON.parse(contents).fields.map(({ path }: { path: string }) => ({
        path,
        claims: [],
      })),
    }),
  }));
});

describe("automated content fact checker", () => {
  it("checks all text fields against current approved facts, including scene voiceover and blog sections", async () => {
    const { checker, memory } = setup();
    expect(await checker.check(studioDocument())).toEqual({
      passed: true,
      flaggedClaims: [],
      suggestions: [],
    });
    expect(memory.getApprovedProductFacts).toHaveBeenCalledWith(projectId);
    const prompt = mocks.generate.mock.calls[0]![0];
    expect(prompt.model).toBe("review-model");
    const payload = JSON.parse(prompt.contents);
    expect(payload.productFacts).toEqual([product]);
    expect(payload.fields.map((field: { path: string }) => field.path)).toEqual(
      expect.arrayContaining([
        "content.short_video.scenes[0].voiceover",
        "content.blog.sections[0].body",
        "content.podcast.show_notes",
      ]),
    );
    expect(prompt.config.systemInstruction).toContain("A matching number alone is not evidence");
  });

  it("flags unsupported features and contradicting pricing with evidence and locations", async () => {
    const { checker } = setup();
    const document = studioDocument();
    document.content.facebook.caption = "Starter includes unlimited users and costs USD 9/month.";
    const result = review(document);
    result.assessments[0]!.claims = [
      {
        claim: "unlimited users",
        verdict: "unsupported",
        evidence_ids: [],
        reason: "Only five users are confirmed.",
      },
      {
        claim: "USD 9/month",
        verdict: "contradicted",
        evidence_ids: [productId],
        reason: "Approved price is USD 29/month.",
      },
    ];
    mocks.generate.mockResolvedValue({ text: JSON.stringify(result) });
    const report = await checker.check(document);
    expect(report.passed).toBe(false);
    expect(report.flaggedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "content.facebook.caption",
          code: "UNSUPPORTED_CLAIM",
          claim: "unlimited users",
        }),
        expect.objectContaining({ code: "CONTRADICTED_CLAIM", evidenceIds: [productId] }),
      ]),
    );
    expect(report.suggestions.length).toBeGreaterThan(0);
  });

  it("accepts a supported claim only with an actual product fact citation", async () => {
    const { checker } = setup();
    const document = studioDocument();
    document.content.facebook.caption = "Starter costs USD 29/month.";
    const result = review(document);
    result.assessments[0]!.claims = [
      {
        claim: "Starter costs USD 29/month.",
        verdict: "supported",
        evidence_ids: [productId],
        reason: "Exact approved pricing.",
      },
    ];
    mocks.generate.mockResolvedValue({ text: JSON.stringify(result) });
    expect((await checker.check(document)).passed).toBe(true);
  });

  it("flags all platform violations locally even when semantic review is unavailable", async () => {
    const { checker } = setup();
    const document = studioDocument();
    document.content.x.thread = ["x".repeat(281)];
    document.content.instagram.carousel_slides = Array(11).fill("A slide");
    document.content.short_video.hook = Array(16).fill("word").join(" ");
    mocks.generate.mockRejectedValue(new Error("Secret provider error"));
    const report = await checker.check(document);
    expect(report.passed).toBe(false);
    expect(report.flaggedClaims.map((claim) => claim.code)).toEqual(
      expect.arrayContaining([
        "X_LENGTH",
        "IG_SLIDE_COUNT",
        "HOOK_LENGTH",
        "VERIFICATION_UNAVAILABLE",
      ]),
    );
    expect(JSON.stringify(report)).not.toContain("Secret provider error");
  });

  it("accepts exact platform boundaries with weighted Unicode counting", async () => {
    const { checker } = setup();
    const document = studioDocument();
    document.content.x.thread = ["😀".repeat(140)];
    document.content.instagram.carousel_slides = Array(10).fill("A slide");
    document.content.short_video.hook = Array(15).fill("word").join(" ");
    expect((await checker.check(document)).passed).toBe(true);
  });

  it.each(["😀".repeat(141), "界".repeat(141)])(
    "flags Unicode posts exceeding X's weighted limit",
    async (tweet) => {
      const { checker } = setup();
      const document = studioDocument();
      document.content.x.thread = [tweet];
      expect((await checker.check(document)).flaggedClaims).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "X_LENGTH" })]),
      );
    },
  );

  it("counts long URLs at their shortened X length", async () => {
    const { checker } = setup();
    const document = studioDocument();
    document.content.x.thread = ["a".repeat(256) + " https://example.com/" + "b".repeat(300)];
    expect((await checker.check(document)).passed).toBe(true);
  });

  it("enforces prohibited brand phrases independently and avoids substring false positives", async () => {
    const { checker, memory } = setup();
    memory.getApprovedBrandRules.mockResolvedValue([
      { ...brand, facts: { negativeKeywords: ["free"], negativeClaims: ["best in the world"] } },
    ]);
    const document = studioDocument();
    document.content.facebook.caption = "Carefree planning is the BEST  IN THE WORLD.";
    const report = await checker.check(document);
    expect(report.flaggedClaims.filter((claim) => claim.code === "BRAND_RULE")).toHaveLength(1);
    expect(report.flaggedClaims[0]?.claim).toBe("best in the world");
  });

  it("fails when a fact used during generation has expired or lost approval", async () => {
    const { checker, memory } = setup();
    memory.getApprovedProductFacts.mockResolvedValue([]);
    const report = await checker.check(studioDocument(), { productFactIds: [productId] });
    expect(report.passed).toBe(false);
    expect(report.flaggedClaims[0]?.code).toBe("VERIFICATION_UNAVAILABLE");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("only checks against retrieved generation evidence when given its IDs", async () => {
    const { checker } = setup();
    await checker.check(studioDocument(), { productFactIds: [] });
    expect(JSON.parse(mocks.generate.mock.calls[0]![0].contents).productFacts).toEqual([]);
  });

  it.each(["missing path", "fake evidence", "unsupported citation", "invented quote", "bad json"])(
    "fails closed for %s",
    async (failure) => {
      const { checker } = setup();
      const document = studioDocument();
      const result = review(document);
      if (failure === "missing path") result.assessments.pop();
      else
        result.assessments[0]!.claims = [
          {
            claim:
              failure === "invented quote"
                ? "Never in the content"
                : document.content.facebook.caption,
            verdict: "supported",
            evidence_ids:
              failure === "fake evidence"
                ? ["99999999-9999-4999-8999-999999999999"]
                : failure === "unsupported citation"
                  ? []
                  : [productId],
            reason: "Review result.",
          },
        ];
      mocks.generate.mockResolvedValue({
        text: failure === "bad json" ? "bad json" : JSON.stringify(result),
      });
      expect((await checker.check(document)).flaggedClaims).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "VERIFICATION_UNAVAILABLE" })]),
      );
    },
  );

  it("does not send oversized review context or unconfigured reviews to the model", async () => {
    const { memory } = setup();
    const missingKey = new FactCheckerService(memory, { model: "test" });
    expect((await missingKey.check(studioDocument())).passed).toBe(false);
    memory.getApprovedProductFacts.mockResolvedValue([
      { ...product, facts: { features: ["x".repeat(200001)] } },
    ]);
    expect(
      (
        await new FactCheckerService(memory, { apiKey: "test", model: "test" }).check(
          studioDocument(),
        )
      ).passed,
    ).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
