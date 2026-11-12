import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { createOnboardingService } from "../src/services/onboarding.service.js";

describe("Onboarding Service Unit Tests", () => {
  const mockQuery = vi.fn();
  const mockPool = {
    query: mockQuery,
  } as unknown as Pool;

  const service = createOnboardingService(mockPool, { allowLocalTest: true });

  describe("analyzeDomain", () => {
    it("extracts brand profile from valid domain with heuristic fallback", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // No existing project

      const result = await service.analyzeDomain("user-1", {
        domain: "https://www.savoir-analytics.test/",
        brandName: "Savoir",
      });

      expect(result.domain).toBe("savoir-analytics.test");
      expect(result.brandProfile.brandName).toBe("Savoir");
      expect(result.brandProfile.aliases).toContain("savoir-analytics.test");
      expect(result.brandProfile.category).toBe("Software & Technology");
      expect(result.brandProfile.products.length).toBeGreaterThan(0);
      expect(result.isEstimated).toBe(true);
    });

    it("rejects duplicate active domains with 409", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "proj-1" }] });

      await expect(
        service.analyzeDomain("user-1", {
          domain: "already-registered.test",
        }),
      ).rejects.toThrowError(/already registered/);
    });
  });

  describe("generateSeeds", () => {
    it("generates 5 to 10 competitors and 25 seed prompts across all intents", async () => {
      const seeds = await service.generateSeeds({
        domain: "mybrand.test",
        brandProfile: {
          brandName: "MyBrand",
          aliases: ["MyBrand Inc"],
          description: "Smart automation platform",
          category: "Software & Technology",
          products: ["MyBrand Cloud"],
          primaryLanguage: "en",
        },
      });

      expect(seeds.competitors.length).toBeGreaterThanOrEqual(5);
      expect(seeds.competitors.length).toBeLessThanOrEqual(10);
      expect(seeds.markets).toEqual([{ country: "US", language: "en" }]);

      expect(seeds.prompts).toHaveLength(25);
      const intents = new Set(seeds.prompts.map((p) => p.intent));
      expect(intents.has("informational")).toBe(true);
      expect(intents.has("comparison")).toBe(true);
      expect(intents.has("transactional")).toBe(true);
      expect(intents.has("navigational")).toBe(true);

      const funnelStages = new Set(seeds.prompts.map((p) => p.funnelStage));
      expect(funnelStages.has("awareness")).toBe(true);
      expect(funnelStages.has("consideration")).toBe(true);
      expect(funnelStages.has("decision")).toBe(true);
    });
  });

  describe("estimateCosts", () => {
    it("calculates daily runs, monthly credits and compares against plan limit", () => {
      const cost1 = service.estimateCosts({
        promptCount: 25,
        engines: ["chatgpt", "gemini"],
      });

      expect(cost1.dailyRuns).toBe(50);
      expect(cost1.monthlyCredits).toBe(1500);
      expect(cost1.planLimit).toBe(2000);
      expect(cost1.withinBudget).toBe(true);

      const cost2 = service.estimateCosts({
        promptCount: 50,
        engines: ["chatgpt", "gemini"],
      });

      expect(cost2.dailyRuns).toBe(100);
      expect(cost2.monthlyCredits).toBe(3000);
      expect(cost2.withinBudget).toBe(false);
    });
  });

  describe("Draft persistence", () => {
    it("saves and retrieves draft properly", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            step: 2,
            data: { domain: "draft.test" },
            updated_at: new Date(),
          },
        ],
      });

      const draft = await service.getDraft("user-1");
      expect(draft?.step).toBe(2);
      expect(draft?.data.domain).toBe("draft.test");
    });
  });
});
