import { describe, expect, it } from "vitest";
import {
  competitorQuerySchema,
  exportCompetitorQuerySchema,
} from "../src/validations/competitor.validation.js";

describe("competitor analytics query validation", () => {
  it("parses boolean query values without treating the string false as true", () => {
    expect(
      competitorQuerySchema.parse({ query: { nonBrandedOnly: "false" } }).query.nonBrandedOnly,
    ).toBe(false);
    expect(
      exportCompetitorQuerySchema.parse({
        query: { nonBrandedOnly: "true" },
      }).query.nonBrandedOnly,
    ).toBe(true);
  });
});
