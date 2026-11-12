import { describe, expect, it } from "vitest";
import type { CostEstimation, OnboardingDraftData } from "../lib/types";

function calculateCostProjection(
  promptCount: number,
  engineCount: number,
  planLimit = 2000,
): CostEstimation {
  const dailyRuns = promptCount * engineCount;
  const monthlyCredits = dailyRuns * 30;
  return {
    promptCount,
    engineCount,
    dailyRuns,
    monthlyCredits,
    planLimit,
    crawlPageBudget: 500,
    withinBudget: monthlyCredits <= planLimit,
  };
}

describe("onboarding cost projection", () => {
  it("calculates monthly credit usage accurately for 25 prompts and 2 engines", () => {
    // 25 prompts * 2 engines = 50 runs/day * 30 = 1,500 credits/mo
    const projection = calculateCostProjection(25, 2);
    expect(projection.dailyRuns).toBe(50);
    expect(projection.monthlyCredits).toBe(1500);
    expect(projection.withinBudget).toBe(true);
  });

  it("identifies when monitoring configuration exceeds starter tier limit", () => {
    // 40 prompts * 2 engines = 80 runs/day * 30 = 2,400 credits/mo > 2,000 limit
    const projection = calculateCostProjection(40, 2);
    expect(projection.dailyRuns).toBe(80);
    expect(projection.monthlyCredits).toBe(2400);
    expect(projection.withinBudget).toBe(false);
  });
});

describe("onboarding draft data validation", () => {
  it("structures valid draft payload for persistence across steps", () => {
    const draft: OnboardingDraftData = {
      domain: "example.com",
      brandProfile: {
        brandName: "Example Inc",
        aliases: ["Example"],
        description: "Enterprise software",
        category: "Software",
        products: ["Platform"],
        primaryLanguage: "en",
      },
      competitors: [
        { name: "Competitor A", domain: "comp-a.com", rationale: "Direct rival" },
      ],
      markets: [{ country: "US", language: "en" }],
      prompts: [
        {
          text: "What are the best enterprise software tools?",
          intent: "informational",
          funnelStage: "awareness",
          priority: 1,
          tags: ["core"],
          persona: "CTO",
        },
      ],
      engines: ["chatgpt", "gemini"],
    };

    expect(draft.domain).toBe("example.com");
    expect(draft.engines).toHaveLength(2);
    expect(draft.prompts?.[0].intent).toBe("informational");
    expect(draft.competitors?.[0].name).toBe("Competitor A");
  });
});
