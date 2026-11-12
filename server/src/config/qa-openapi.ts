const source = { type: "string", enum: ["faq", "support_ticket", "reddit", "survey"] };
const intent = { type: "string", enum: ["awareness", "consideration", "decision", "retention"] };
const status = { type: "string", enum: ["backlog", "planned", "published", "dismissed"] };
const score = { type: "integer", minimum: 0, maximum: 100 };
const questionInput = {
  type: "object",
  additionalProperties: false,
  required: ["source", "questionText"],
  properties: {
    source,
    questionText: { type: "string", minLength: 3, maxLength: 4000 },
    demandScore: score,
    businessPriority: { ...score, default: 50 },
  },
};
const questionList = { type: "array", minItems: 1, maxItems: 100, items: questionInput };
const questionOutput = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    source,
    questionText: { type: "string" },
    intent,
    status,
    demandScore: score,
    businessPriority: score,
    priorityScore: { type: "number" },
    createdAt: { type: "string", format: "date-time" },
    recommendedFormats: { type: "array", items: { type: "string" } },
  },
};
const projectParameter = {
  name: "projectId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const errors = {
  "400": { description: "Invalid import, CSV, project ID or query" },
  "401": { description: "Authentication required" },
  "404": { description: "Project not found or not owned by this user" },
  "429": { description: "Rate limited" },
  "503": { description: "Classifier not configured or rate limiter unavailable" },
};
const response = (properties: Record<string, unknown>) => ({
  description: "Successful request",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "integer" },
          success: { type: "boolean" },
          message: { type: "string" },
          data: { type: "object", properties },
        },
      },
    },
  },
});
export const qaApiPaths = {
  "/v1/projects/{projectId}/qa/ingest": {
    post: {
      operationId: "ingestCustomerQuestions",
      tags: ["Customer Q&A"],
      security: [{ accessCookie: [] }],
      description:
        "Owner-only bulk import of up to 100 questions. Classifies new questions using Gemini. Duplicates in the same source are skipped; existing scores and status remain unchanged. All classification completes before insertion. Requires a signed CSRF cookie and matching header.",
      parameters: [
        projectParameter,
        { name: "X-CSRF-Token", in: "header", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              oneOf: [
                questionList,
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["questions"],
                  properties: { questions: questionList },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["csv"],
                  properties: { csv: { type: "string" } },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["tickets"],
                  properties: {
                    tickets: {
                      type: "array",
                      minItems: 1,
                      maxItems: 100,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["subject"],
                        properties: {
                          subject: { type: "string", minLength: 1, maxLength: 500 },
                          description: { type: "string", maxLength: 3500 },
                          demandScore: score,
                          businessPriority: score,
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
          "text/csv": {
            schema: { type: "string" },
            example: "source,question_text,demand_score,business_priority\nfaq,What is AEO?,75,80",
          },
          "application/csv": { schema: { type: "string" } },
        },
      },
      responses: {
        "200": response({
          received: { type: "integer" },
          imported: { type: "integer" },
          duplicates: { type: "integer" },
          questions: { type: "array", items: questionOutput },
        }),
        ...errors,
        "403": { description: "CSRF verification failed" },
        "413": { description: "Request exceeds 1 MB" },
        "415": { description: "Use application/json or text/csv" },
        "502": { description: "Classification failed or was malformed; no questions imported" },
      },
    },
  },
  "/v1/projects/{projectId}/qa/opportunities": {
    get: {
      operationId: "listQuestionOpportunities",
      tags: ["Customer Q&A"],
      security: [{ accessCookie: [] }],
      description:
        "Owner-only backlog, ordered by priorityScore = 0.6 * demandScore + 0.4 * businessPriority, then demand descending and creation time/ID ascending. Default demand is the frequency in the first import batch, capped at 100; default business priority is 50. Scores are signals supplied by the importer, not inferred search volume.",
      parameters: [
        projectParameter,
        { name: "intent", in: "query", schema: intent },
        { name: "source", in: "query", schema: source },
        { name: "status", in: "query", schema: { ...status, default: "backlog" } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        {
          name: "offset",
          in: "query",
          schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
        },
      ],
      responses: {
        "200": response({
          questions: { type: "array", items: questionOutput },
          nextOffset: { type: ["integer", "null"] },
        }),
        ...errors,
      },
    },
  },
};
