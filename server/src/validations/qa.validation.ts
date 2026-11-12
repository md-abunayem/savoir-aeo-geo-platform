import { z } from "zod";
import { ApiError } from "../utils/ApiError.js";

export const questionSource = z.enum(["faq", "support_ticket", "reddit", "survey"]);
export const questionIntent = z.enum(["awareness", "consideration", "decision", "retention"]);
export const questionStatus = z.enum(["backlog", "planned", "published", "dismissed"]);
const score = z.number().int().min(0).max(100);
const question = z
  .object({
    source: questionSource,
    questionText: z.string().trim().min(3).max(4000),
    demandScore: score.optional(),
    businessPriority: score.default(50),
  })
  .strict();
export type QuestionInput = z.output<typeof question>;
const questions = z.array(question).min(1).max(100);
export const opportunitiesQuery = z
  .object({
    intent: questionIntent.optional(),
    source: questionSource.optional(),
    status: questionStatus.default("backlog"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

/** RFC 4180-style quoted fields, including escaped quotes and embedded newlines. */
export function parseQuestionCsv(csv: string): QuestionInput[] {
  if (Buffer.byteLength(csv, "utf8") > 1024 * 1024) {
    throw new ApiError(413, "CSV exceeds 1 MB", "PAYLOAD_TOO_LARGE");
  }
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const invalid = () => new ApiError(400, "Invalid question CSV", "INVALID_CSV");
  const finishField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    if (rows.length > 101)
      throw new ApiError(400, "Import at most 100 questions", "VALIDATION_ERROR");
  };
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || closed) throw invalid();
      quoted = true;
    } else if (c === ",") finishField();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      finishRow();
    } else {
      if (closed) throw invalid();
      field += c;
    }
  }
  if (quoted) throw invalid();
  if (field || row.length || closed) finishRow();
  const headers = rows.shift()?.map((h) => h.replace(/^\uFEFF/, "").trim());
  const allowed = ["source", "question_text", "demand_score", "business_priority"];
  if (
    !headers ||
    !headers.includes("source") ||
    !headers.includes("question_text") ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !allowed.includes(h))
  )
    throw invalid();
  return questions.parse(
    rows.map((cells) => {
      if (cells.length !== headers.length) throw invalid();
      const record = Object.fromEntries(headers.map((h, i) => [h, cells[i]!.trim()]));
      return {
        source: record.source,
        questionText: record.question_text,
        demandScore: record.demand_score ? Number(record.demand_score) : undefined,
        businessPriority: record.business_priority ? Number(record.business_priority) : undefined,
      };
    }),
  );
}

export function parseQaIngestion(input: unknown): QuestionInput[] {
  if (typeof input === "string") return parseQuestionCsv(input);
  if (Array.isArray(input)) return questions.parse(input);
  const body = z
    .union([
      z.object({ questions }).strict(),
      z.object({ csv: z.string() }).strict(),
      z
        .object({
          tickets: z
            .array(
              z
                .object({
                  subject: z.string().trim().min(1).max(500),
                  description: z.string().trim().max(3500).optional(),
                  demandScore: score.optional(),
                  businessPriority: score.optional(),
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict(),
    ])
    .parse(input);
  if ("questions" in body) return body.questions;
  if ("csv" in body) return parseQuestionCsv(body.csv);
  return questions.parse(
    body.tickets.map((ticket) => ({
      source: "support_ticket",
      questionText: [ticket.subject, ticket.description].filter(Boolean).join("\n"),
      demandScore: ticket.demandScore,
      businessPriority: ticket.businessPriority,
    })),
  );
}
