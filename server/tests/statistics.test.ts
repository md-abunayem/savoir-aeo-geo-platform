import { describe, expect, it } from "vitest";
import {
  calculateWilsonInterval,
  evaluateConfidence,
  calculateTwoProportionZTest,
  applyBenjaminiHochberg,
  assignGradeBand,
  calculateCompositeScore,
  calculateRollingAverage,
  AnomalyCandidate,
} from "../src/services/analytics/statistics.js";

describe("Normative Statistics Service (M3 & VIS)", () => {
  describe("Wilson Score Confidence Interval", () => {
    it("returns zero interval when sample size is zero", () => {
      const res = calculateWilsonInterval(0, 0);
      expect(res.low).toBe(0);
      expect(res.high).toBe(0);
    });

    it("calculates symmetric interval around 0.5 for large sample", () => {
      const res = calculateWilsonInterval(50, 100); // 50%
      expect(res.low).toBeGreaterThan(0.39);
      expect(res.high).toBeLessThan(0.61);
      expect(res.low).toBeLessThan(res.high);
    });

    it("handles 0 successes gracefully without going below 0", () => {
      const res = calculateWilsonInterval(0, 20);
      expect(res.low).toBe(0);
      expect(res.high).toBeGreaterThan(0);
      expect(res.high).toBeLessThan(0.2);
    });

    it("handles 100% successes gracefully without going above 1", () => {
      const res = calculateWilsonInterval(20, 20);
      expect(res.high).toBe(1);
      expect(res.low).toBeGreaterThan(0.8);
      expect(res.low).toBeLessThan(1);
    });
  });

  describe("Minimum Sample Size Confidence Rule (SRS Section 9.2)", () => {
    it("marks n < 3 as insufficient and not displayable", () => {
      const eval0 = evaluateConfidence(0);
      expect(eval0.tier).toBe("insufficient");
      expect(eval0.displayable).toBe(false);

      const eval2 = evaluateConfidence(2);
      expect(eval2.tier).toBe("insufficient");
      expect(eval2.displayable).toBe(false);
    });

    it("marks 3 <= n < 5 as low confidence and displayable with warning", () => {
      const eval3 = evaluateConfidence(3);
      expect(eval3.tier).toBe("low_confidence");
      expect(eval3.displayable).toBe(true);

      const eval4 = evaluateConfidence(4);
      expect(eval4.tier).toBe("low_confidence");
      expect(eval4.displayable).toBe(true);
    });

    it("marks n >= 5 as adequate / high confidence", () => {
      const eval5 = evaluateConfidence(5);
      expect(eval5.tier).toBe("adequate");
      expect(eval5.displayable).toBe(true);

      const eval50 = evaluateConfidence(50);
      expect(eval50.tier).toBe("adequate");
      expect(eval50.displayable).toBe(true);
    });
  });

  describe("Two-Proportion Z-Test", () => {
    it("detects no significant change when proportions are identical", () => {
      const res = calculateTwoProportionZTest(20, 50, 20, 50);
      expect(res.delta).toBe(0);
      expect(res.z).toBe(0);
      expect(res.pValue).toBe(1);
      expect(res.significant).toBe(false);
    });

    it("detects statistically significant change between 80% and 20% with n=50", () => {
      const res = calculateTwoProportionZTest(40, 50, 10, 50);
      expect(res.delta).toBe(0.6);
      expect(res.z).toBeGreaterThan(5);
      expect(res.pValue).toBeLessThan(0.001);
      expect(res.significant).toBe(true);
    });

    it("handles zero trials safely", () => {
      const res = calculateTwoProportionZTest(0, 0, 10, 50);
      expect(res.pValue).toBe(1);
      expect(res.significant).toBe(false);
    });
  });

  describe("Benjamini-Hochberg FDR Procedure", () => {
    it("controls false discovery rate and computes q-values", () => {
      const candidates: AnomalyCandidate[] = [
        {
          id: "1",
          metric: "visibility_rate",
          entityName: "Brand",
          engine: "openai",
          currentValue: 0.8,
          previousValue: 0.2,
          currentN: 50,
          previousN: 50,
          delta: 0.6,
          pValue: 0.0001,
          significant: true,
        },
        {
          id: "2",
          metric: "visibility_rate",
          entityName: "Brand",
          engine: "gemini",
          currentValue: 0.52,
          previousValue: 0.48,
          currentN: 50,
          previousN: 50,
          delta: 0.04,
          pValue: 0.68,
          significant: false,
        },
        {
          id: "3",
          metric: "visibility_rate",
          entityName: "Comp A",
          engine: "google_ai_overviews",
          currentValue: 0.75,
          previousValue: 0.3,
          currentN: 40,
          previousN: 40,
          delta: 0.45,
          pValue: 0.0005,
          significant: true,
        },
      ];

      const adjusted = applyBenjaminiHochberg(candidates, 0.05);
      expect(adjusted.length).toBe(3);
      // Candidates 1 and 3 should remain significant
      const item1 = adjusted.find((c) => c.id === "1");
      const item2 = adjusted.find((c) => c.id === "2");
      const item3 = adjusted.find((c) => c.id === "3");

      expect(item1?.significant).toBe(true);
      expect(item1?.qValue).toBeLessThan(0.05);

      expect(item2?.significant).toBe(false);
      expect(item2?.qValue).toBeGreaterThan(0.5);

      expect(item3?.significant).toBe(true);
      expect(item3?.qValue).toBeLessThan(0.05);
    });
  });

  describe("Grade Band Mapping & Composite AI Visibility Score", () => {
    it("maps scores to correct grade bands", () => {
      expect(assignGradeBand(90)).toBe("A");
      expect(assignGradeBand(85)).toBe("A");
      expect(assignGradeBand(84.9)).toBe("B");
      expect(assignGradeBand(70)).toBe("B");
      expect(assignGradeBand(69.9)).toBe("C");
      expect(assignGradeBand(55)).toBe("C");
      expect(assignGradeBand(54.9)).toBe("D");
      expect(assignGradeBand(40)).toBe("D");
      expect(assignGradeBand(39.9)).toBe("F");
      expect(assignGradeBand(0)).toBe("F");
    });

    it("calculates composite score accurately according to formula", () => {
      // Score = 100 * (0.45 * V + 0.20 * min(1, SoV/FairShare) + 0.15 * Pos + 0.10 * Sent + 0.10 * CR)
      // When all are 1.0 (and SoV >= FairShare): score = 100 * (0.45 + 0.20 + 0.15 + 0.10 + 0.10) = 100
      const perfect = calculateCompositeScore({
        visibilityRate: 1.0,
        shareOfVoice: 0.5,
        competitorCount: 1, // fairShare = 1 / (1 + 1) = 0.5 -> SoV / fairShare = 1.0
        positionScore: 1.0,
        sentimentScore: 1.0,
        citationRate: 1.0,
      });
      expect(perfect.score).toBe(100);
      expect(perfect.grade).toBe("A");
      expect(perfect.fairShare).toBe(0.5);
      expect(perfect.sovRatio).toBe(1.0);

      // Half across the board:
      // 100 * (0.45 * 0.5 + 0.20 * 0.5 + 0.15 * 0.5 + 0.10 * 0.5 + 0.10 * 0.5) = 50 -> Grade D
      const half = calculateCompositeScore({
        visibilityRate: 0.5,
        shareOfVoice: 0.25,
        competitorCount: 1, // fairShare = 0.5 -> ratio = 0.25 / 0.5 = 0.5
        positionScore: 0.5,
        sentimentScore: 0.5,
        citationRate: 0.5,
      });
      expect(half.score).toBe(50);
      expect(half.grade).toBe("D");
    });
  });

  describe("7-Day Rolling Average", () => {
    it("computes 7-day rolling window average correctly", () => {
      const data = [
        { date: "2026-03-01", value: 10 },
        { date: "2026-03-02", value: 20 },
        { date: "2026-03-03", value: 30 },
      ];
      const res = calculateRollingAverage(data, 7);
      expect(res.length).toBe(3);
      expect(res[0].rollingAvg).toBe(10); // only 1 day
      expect(res[1].rollingAvg).toBe(15); // (10+20)/2
      expect(res[2].rollingAvg).toBe(20); // (10+20+30)/3
    });
  });
});
