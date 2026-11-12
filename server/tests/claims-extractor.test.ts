import { describe, it, expect } from "vitest";
import { extractBrandClaims } from "../src/services/answer/claims-extractor.js";

describe("Claims Extractor (ANS-FR-008)", () => {
  it("extracts pricing, comparison, and feature claims for a brand", () => {
    const text = `
Acme provides a generous free tier and subscriptions starting at $29 per month.
Compared to LegacyCorp, Acme delivers three times faster query processing.
Acme operates in North America and Europe with 99.99% uptime.
Acme features an intuitive analytics dashboard with automated alerts.
    `;

    const claims = extractBrandClaims(text, "Acme", ["Acme Corp"]);

    expect(claims.length).toBeGreaterThanOrEqual(4);

    const pricing = claims.find((c) => c.theme === "pricing");
    expect(pricing).toBeDefined();
    expect(pricing?.claimText).toContain("$29 per month");
    expect(pricing?.label).toBe("Estimated");

    const comparison = claims.find((c) => c.theme === "comparisons");
    expect(comparison).toBeDefined();
    expect(comparison?.claimText).toContain("Compared to LegacyCorp");

    const features = claims.find((c) => c.theme === "features");
    expect(features).toBeDefined();
    expect(features?.claimText).toContain("analytics dashboard");
  });
});
