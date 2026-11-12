export const answerApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/answers": {
    get: {
      operationId: "listAnswers",
      summary: "List answers with filtering, full-text search, and pagination",
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "projectId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        { name: "engine", in: "query", schema: { type: "string" } },
        { name: "promptId", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "search", in: "query", schema: { type: "string" } },
        {
          name: "brandMentioned",
          in: "query",
          schema: { type: "string", enum: ["true", "false"] },
        },
        { name: "sentiment", in: "query", schema: { type: "string", enum: ["-1", "0", "1"] } },
        { name: "citationDomain", in: "query", schema: { type: "string" } },
        { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
      ],
      responses: {
        "200": { description: "Filterable answers list" },
        "401": { description: "Unauthenticated" },
        "404": { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/answers/{id}": {
    get: {
      operationId: "getAnswer",
      summary: "Get full answer details including mentions, citations, claims, and flags",
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "projectId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": { description: "Answer details" },
        "404": { description: "Answer not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/answers/compare": {
    get: {
      operationId: "compareAnswers",
      summary: "Compare answers across engines or timeline diff for prompt-engine pair",
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "projectId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        { name: "promptId", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "answerId1", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "answerId2", in: "query", schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        "200": { description: "Comparison result" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/answers/{id}/flag": {
    post: {
      operationId: "flagAnswer",
      summary: "Flag an answer or claim as inaccurate or misleading",
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "projectId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["reason"],
              properties: {
                reason: { type: "string" },
                note: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Answer flagged" },
      },
    },
  },
};
