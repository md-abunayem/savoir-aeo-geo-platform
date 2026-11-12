export const visibilityApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/visibility": {
    get: {
      operationId: "getVisibilityOverview",
      summary: "Get AI Visibility overview KPIs, Composite Score, and breakdowns",
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
        {
          name: "engine",
          in: "query",
          schema: {
            type: "string",
            enum: [
              "all",
              "openai",
              "gemini",
              "google_ai_overviews",
              "google_ai_mode",
              "openrouter",
            ],
          },
        },
        { name: "market", in: "query", schema: { type: "string" } },
        { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } },
      ],
      responses: {
        "200": { description: "Visibility overview metrics and breakdowns" },
        "401": { description: "Unauthenticated" },
        "404": { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/visibility/trend": {
    get: {
      operationId: "getVisibilityTrend",
      summary: "Get visibility trend with 7-day rolling smoothing and event annotations",
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
        { name: "dateFrom", in: "query", schema: { type: "string" } },
        { name: "dateTo", in: "query", schema: { type: "string" } },
        { name: "days", in: "query", schema: { type: "integer", default: 7 } },
      ],
      responses: {
        "200": { description: "Daily trend points and milestones" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/visibility/anomalies": {
    get: {
      operationId: "getVisibilityAnomalies",
      summary:
        "Detect statistically significant visibility shifts using two-proportion z-tests with FDR control",
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
        "200": { description: "List of detected anomalies" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/visibility/export": {
    get: {
      operationId: "exportVisibilityCsv",
      summary: "Export visibility metrics in CSV format",
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
        "200": {
          description: "CSV text file",
          content: { "text/csv": { schema: { type: "string" } } },
        },
      },
    },
  },
};
