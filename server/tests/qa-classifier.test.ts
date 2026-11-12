import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_FORMATS,
  QaClassifierService,
} from "../src/services/intelligence/qa-classifier.service.js";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generate };
  },
}));
const classifier = () => new QaClassifierService({ apiKey: "test", model: "configured-model" });
const response = (intents: string[]) => ({
  text: JSON.stringify({ classifications: intents.map((intent, index) => ({ index, intent })) }),
});
beforeEach(() => vi.resetAllMocks());

describe("Q&A intent classification", () => {
  it("uses few-shot prompting and maps all four intents to the blueprint", async () => {
    const intents = ["awareness", "consideration", "decision", "retention"] as const;
    mocks.generate.mockResolvedValue(response([...intents]));
    expect(
      await classifier().classify([
        "What is AEO?",
        "How do tools compare?",
        "Can I see a demo?",
        "How do I reconnect?",
      ]),
    ).toEqual(intents.map((intent) => ({ intent, recommendedFormats: CONTENT_FORMATS[intent] })));
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "configured-model",
        config: expect.objectContaining({
          responseMimeType: "application/json",
          systemInstruction: expect.stringContaining("Few-shot examples"),
        }),
      }),
    );
  });

  it("batches large imports while preserving classification order", async () => {
    mocks.generate
      .mockResolvedValueOnce(response(Array(25).fill("awareness")))
      .mockResolvedValueOnce(response(["decision"]));
    const result = await classifier().classify(Array(26).fill("What is AEO?"));
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(result[25]?.intent).toBe("decision");
    expect(JSON.parse(mocks.generate.mock.calls[1]![0].contents)).toEqual([
      { index: 0, question: "What is AEO?" },
    ]);
  });

  it.each([
    "not json",
    JSON.stringify({ classifications: [{ index: 0, intent: "purchase" }] }),
    JSON.stringify({ classifications: [] }),
    JSON.stringify({ classifications: [{ index: 1, intent: "decision" }] }),
    JSON.stringify({ classifications: [{ index: 0, intent: "decision", extra: "injected" }] }),
  ])("rejects malformed or incomplete output: %s", async (text) => {
    mocks.generate.mockResolvedValue({ text });
    await expect(classifier().classify(["Can I get a demo?"])).rejects.toMatchObject({
      code: "QA_CLASSIFICATION_FAILED",
    });
  });

  it("sanitizes provider errors and fails explicitly when not configured", async () => {
    mocks.generate.mockRejectedValue(new Error("secret provider response"));
    await expect(classifier().classify(["What is AEO?"])).rejects.toMatchObject({
      code: "QA_CLASSIFICATION_FAILED",
    });
    await expect(
      new QaClassifierService({ model: "test" }).classify(["What is AEO?"]),
    ).rejects.toMatchObject({ code: "QA_NOT_CONFIGURED" });
  });
});
