import { describe, expect, it } from "vitest";
import { opportunitiesQuery, parseQaIngestion } from "../src/validations/qa.validation.js";

describe("question imports", () => {
  it("accepts JSON arrays and envelopes without allowing client-supplied classification", () => {
    const questions = [{ source: "faq", questionText: "What is AEO?", demandScore: 80 }];
    expect(parseQaIngestion(questions)).toEqual(parseQaIngestion({ questions }));
    expect(parseQaIngestion(questions)[0]?.businessPriority).toBe(50);
    expect(() => parseQaIngestion([{ ...questions[0], intent: "decision" }])).toThrow();
  });

  it("parses quoted CSV, BOM headers, commas, escaped quotes and multiline text", () => {
    const csv =
      '\uFEFFsource,question_text,demand_score,business_priority\r\nfaq,"How does ""AEO"" work,\nfor us?",85,90\r\n';
    expect(parseQaIngestion(csv)).toEqual([
      {
        source: "faq",
        questionText: 'How does "AEO" work,\nfor us?',
        demandScore: 85,
        businessPriority: 90,
      },
    ]);
    expect(parseQaIngestion({ csv })).toEqual(parseQaIngestion(csv));
  });

  it("maps ticket subject and description to a support question", () => {
    expect(
      parseQaIngestion({
        tickets: [{ subject: "How do I reconnect?", description: "My connection expired." }],
      }),
    ).toEqual([
      {
        source: "support_ticket",
        questionText: "How do I reconnect?\nMy connection expired.",
        businessPriority: 50,
      },
    ]);
  });

  it.each([
    'source,question_text\nfaq,"unterminated',
    'source,question_text\nfaq,"valid"oops',
    "source,source,question_text\nfaq,faq,Why?",
    "question_text\nWhy?",
    "source,question_text,unknown\nfaq,Why?,value",
    "source,question_text\nfaq,Why?,extra",
    "source,question_text,demand_score\nfaq,Why?,101",
    "source,question_text\nunknown,Why?",
    "source,question_text\n",
  ])("rejects malformed CSV: %s", (csv) => expect(() => parseQaIngestion(csv)).toThrow());

  it("bounds batches, text lengths, scores and pagination", () => {
    expect(() =>
      parseQaIngestion(Array(101).fill({ source: "faq", questionText: "Why?" })),
    ).toThrow();
    expect(() => parseQaIngestion([{ source: "faq", questionText: "x".repeat(4001) }])).toThrow();
    expect(() =>
      parseQaIngestion([{ source: "faq", questionText: "Why?", businessPriority: -1 }]),
    ).toThrow();
    expect(() => opportunitiesQuery.parse({ limit: "101" })).toThrow();
    expect(() => opportunitiesQuery.parse({ intent: "purchase" })).toThrow();
    expect(() => opportunitiesQuery.parse({ offset: "-1" })).toThrow();
    expect(opportunitiesQuery.parse({})).toEqual({ status: "backlog", limit: 50, offset: 0 });
  });
});
