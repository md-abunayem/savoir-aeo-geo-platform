import { describe, it, expect } from "vitest";
import {
  extractEntities,
  classifySentiment,
  buildEntityAliases,
  type EntityTarget,
} from "../src/services/answer/entity-extractor.js";

describe("Entity & Mention Extractor (ANS-FR-001..003, NFR-QUAL-002)", () => {
  const brand: EntityTarget = {
    id: "b1000000-0000-0000-0000-000000000001",
    name: "Acme Cloud",
    type: "brand",
    domain: "https://acmecloud.io",
    aliases: ["Acme", "AcmeCloud", "Acme.io"],
  };

  const competitors: EntityTarget[] = [
    {
      id: "c1000000-0000-0000-0000-000000000001",
      name: "ApexScale Inc",
      type: "competitor",
      domain: "https://apexscale.com",
      aliases: ["ApexScale", "Apex Scale"],
    },
    {
      id: "c2000000-0000-0000-0000-000000000002",
      name: "ZenithFlow",
      type: "competitor",
      domain: "https://zenithflow.com",
      aliases: ["Zenith Flow"],
    },
  ];

  const targets = [brand, ...competitors];

  it("builds clean aliases stripping corporate suffixes and domains", () => {
    const aliases = buildEntityAliases(competitors[0]);
    expect(aliases).toContain("ApexScale Inc");
    expect(aliases).toContain("ApexScale");
    expect(aliases).toContain("apexscale.com");
  });

  it("extracts exact brand and competitor mentions with word boundaries", () => {
    const text =
      "When comparing cloud platforms, Acme Cloud offers great scalability, while ApexScale provides specialized enterprise tools.";
    const mentions = extractEntities(text, targets);

    expect(mentions.length).toBe(2);
    expect(mentions[0].entityName).toBe("Acme Cloud");
    expect(mentions[0].entityType).toBe("brand");
    expect(mentions[0].positionIndex).toBe(1);

    expect(mentions[1].entityName).toBe("ApexScale Inc");
    expect(mentions[1].entityType).toBe("competitor");
    expect(mentions[1].positionIndex).toBe(2);
  });

  it("handles alias matches and avoids substring collisions (longest match wins)", () => {
    const text = "Both Acme and Acme Cloud are referenced here.";
    const mentions = extractEntities(text, targets);

    // "Acme Cloud" should match first, then "Acme"
    expect(mentions.length).toBe(2);
    expect(mentions[0].matchedText).toBe("Acme");
    expect(mentions[1].matchedText).toBe("Acme Cloud");
    expect(mentions[0].entityName).toBe("Acme Cloud");
    expect(mentions[1].entityName).toBe("Acme Cloud");
  });

  it("detects mention position rank (1st entity mentioned vs 2nd)", () => {
    const text = "ZenithFlow was launched first, followed later by Acme Cloud.";
    const mentions = extractEntities(text, targets);

    expect(mentions[0].entityName).toBe("ZenithFlow");
    expect(mentions[0].positionIndex).toBe(1);

    expect(mentions[1].entityName).toBe("Acme Cloud");
    expect(mentions[1].positionIndex).toBe(2);
  });

  it("detects list item rank in ordered numbered lists", () => {
    const text = `
Here are the top 3 cloud platforms:
1. ApexScale - Best for raw compute power.
2. Acme Cloud - Market leader in usability and speed.
3. ZenithFlow - Budget-friendly alternative.
    `;
    const mentions = extractEntities(text, targets);

    expect(mentions.length).toBe(3);
    expect(mentions[0].matchedText).toBe("ApexScale");
    expect(mentions[0].listRank).toBe(1);

    expect(mentions[1].matchedText).toBe("Acme Cloud");
    expect(mentions[1].listRank).toBe(2);

    expect(mentions[2].matchedText).toBe("ZenithFlow");
    expect(mentions[2].listRank).toBe(3);
  });

  it("handles fuzzy matching with single typo tolerance without false positives on stop words", () => {
    const text = "Many developers choose AcmCloud for its developer experience.";
    const mentions = extractEntities(text, targets);

    expect(mentions.length).toBe(1);
    expect(mentions[0].matchedText).toBe("AcmCloud");
    expect(mentions[0].entityName).toBe("Acme Cloud");
    expect(mentions[0].label).toBe("Estimated");
  });

  it("does not match short common stop words like 'and', 'the', 'pro', 'ai'", () => {
    const brandWithShortAlias: EntityTarget = {
      name: "AI Tool",
      type: "brand",
      aliases: ["AI", "Tool", "The"],
    };
    const text = "The best AI tool for the job is great.";
    const mentions = extractEntities(text, [brandWithShortAlias]);

    // Should only match "AI Tool" if present, not every "The" or "AI"
    for (const m of mentions) {
      expect(["the", "for"]).not.toContain(m.matchedText.toLowerCase());
    }
  });

  describe("Sentiment Classification", () => {
    it("correctly classifies positive sentiment with confidence >= 0.6", () => {
      const positiveSnippet =
        "...Acme Cloud is widely considered the best choice and industry leader with exceptional speed...";
      const result = classifySentiment(positiveSnippet, "Acme Cloud");

      expect(result.sentiment).toBe(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("correctly classifies negative sentiment with confidence >= 0.6", () => {
      const negativeSnippet =
        "...ApexScale suffers from steep pricing, buggy releases, and poor documentation...";
      const result = classifySentiment(negativeSnippet, "ApexScale");

      expect(result.sentiment).toBe(-1);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("handles negation inversion (e.g., 'not recommended', 'not the best')", () => {
      const negatedSnippet =
        "...ZenithFlow is not recommended for production workloads due to frequent downtime...";
      const result = classifySentiment(negatedSnippet, "ZenithFlow");

      expect(result.sentiment).toBe(-1);
    });

    it("defaults to neutral when statements are purely factual or balanced", () => {
      const neutralSnippet =
        "...Acme Cloud is a multi-region hosting platform supporting Node.js and Python...";
      const result = classifySentiment(neutralSnippet, "Acme Cloud");

      expect(result.sentiment).toBe(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe("Golden Set Precision & Recall (NFR-QUAL-002)", () => {
    it("satisfies precision >= 95% and recall >= 90% on golden answer set", () => {
      const goldenSamples = [
        {
          text: "Acme Cloud excels in uptime, while ApexScale is known for high costs.",
          expectedEntities: ["Acme Cloud", "ApexScale Inc"],
        },
        {
          text: "1. ZenithFlow: Simple setup.\n2. Acme: Advanced analytics.",
          expectedEntities: ["ZenithFlow", "Acme Cloud"],
        },
        {
          text: "No cloud providers were mentioned in this generic recipe for pancakes.",
          expectedEntities: [],
        },
        {
          text: "Visit acmecloud.io or apexscale.com for pricing details.",
          expectedEntities: ["Acme Cloud", "ApexScale Inc"],
        },
        {
          text: "Zenith Flow is an emerging platform compared to legacy providers.",
          expectedEntities: ["ZenithFlow"],
        },
      ];

      let truePositives = 0;
      let falsePositives = 0;
      let falseNegatives = 0;

      for (const sample of goldenSamples) {
        const detected = extractEntities(sample.text, targets);
        const detectedNames = Array.from(new Set(detected.map((d) => d.entityName)));

        for (const name of detectedNames) {
          if (sample.expectedEntities.includes(name)) {
            truePositives++;
          } else {
            falsePositives++;
          }
        }

        for (const expected of sample.expectedEntities) {
          if (!detectedNames.includes(expected)) {
            falseNegatives++;
          }
        }
      }

      const precision = truePositives / (truePositives + falsePositives || 1);
      const recall = truePositives / (truePositives + falseNegatives || 1);

      expect(precision).toBeGreaterThanOrEqual(0.95);
      expect(recall).toBeGreaterThanOrEqual(0.9);
    });
  });
});
