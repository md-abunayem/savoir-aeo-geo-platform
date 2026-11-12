export const citationApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/citations": {
    get: {
      operationId: "getCitationOverview",
      summary:
        "Get Citation Intelligence overview, brand citation rate, distribution, and top domains",
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
        { name: "dateFrom", in: "query", schema: { type: "string", example: "2026-03-01" } },
        { name: "dateTo", in: "query", schema: { type: "string", example: "2026-03-07" } },
        { name: "days", in: "query", schema: { type: "integer", default: 7 } },
        { name: "engine", in: "query", schema: { type: "string" } },
        { name: "sourceType", in: "query", schema: { type: "string" } },
        { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } },
      ],
      responses: {
        "200": { description: "Citation overview response" },
        "401": { description: "Unauthenticated" },
        "404": { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/citations/domains": {
    get: {
      operationId: "listDomainCitations",
      summary: "List cited domains with citation share, distinct pages, and trend status",
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
        { name: "sourceType", in: "query", schema: { type: "string" } },
        { name: "search", in: "query", schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "List of domain citations" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/citations/pages": {
    get: {
      operationId: "listPageCitations",
      summary: "List cited pages and top brand pages",
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
        { name: "domain", in: "query", schema: { type: "string" } },
        { name: "onlyBrandPages", in: "query", schema: { type: "boolean" } },
      ],
      responses: {
        "200": { description: "List of page citations" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/citations/gaps": {
    get: {
      operationId: "getCitationGaps",
      summary:
        "Identify citations awarded to competitors where brand is missing for the same prompts",
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
        { name: "minOpportunityScore", in: "query", schema: { type: "number" } },
      ],
      responses: {
        "200": { description: "List of citation gaps ranked by opportunity score" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/citations/broken": {
    get: {
      operationId: "listBrokenCitations",
      summary: "List detected citations pointing to broken (4xx/5xx) or redirected brand URLs",
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
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["open", "resolved", "ignored"] },
        },
      ],
      responses: {
        "200": { description: "List of broken citations" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/citations/broken/detect": {
    post: {
      operationId: "detectBrokenCitations",
      summary: "Trigger live check of brand cited URLs to discover broken 4xx/5xx or redirects",
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
      ],
      responses: {
        "200": { description: "Broken citation scan results" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/citations/sources": {
    get: {
      operationId: "listSourceDomains",
      summary: "List source domain classification overrides and allow/deny lists",
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
      ],
      responses: {
        "200": { description: "List of source domain rules" },
      },
    },
  },
};
