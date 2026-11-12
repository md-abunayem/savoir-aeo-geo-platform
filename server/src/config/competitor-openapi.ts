export const competitorApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors": {
    get: {
      operationId: "listCompetitors",
      summary: "List managed competitors with visibility, SoV, and head-to-head metrics",
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
        { name: "search", in: "query", schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "List of competitors with metrics" },
        "401": { description: "Unauthenticated" },
        "404": { description: "Project not found" },
      },
    },
    post: {
      operationId: "createCompetitor",
      summary: "Add a competitor (enforcing 25 max limit and ambiguous name checks)",
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
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "domain"],
              properties: {
                name: { type: "string" },
                domain: { type: "string" },
                aliases: { type: "array", items: { type: "string" } },
                competitorType: {
                  type: "string",
                  enum: ["direct", "indirect", "aspirational"],
                  default: "direct",
                },
                rationale: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Competitor created successfully" },
        "400": { description: "Invalid input or max 25 competitors reached" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/topics": {
    get: {
      operationId: "listCompetitorTopics",
      summary: "List available prompt topics for competitor analytics filters",
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
        "200": { description: "Available prompt topics" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/leaderboard": {
    get: {
      operationId: "getCompetitorLeaderboard",
      summary: "Competitor leaderboard ranking brand and competitors across engines and periods",
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
        { name: "days", in: "query", schema: { type: "integer", default: 7 } },
        { name: "engine", in: "query", schema: { type: "string" } },
        { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
        { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
        { name: "topic", in: "query", schema: { type: "string" } },
        { name: "nonBrandedOnly", in: "query", schema: { type: "boolean" } },
      ],
      responses: {
        "200": { description: "Competitor leaderboard" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/gaps": {
    get: {
      operationId: "getCompetitiveGaps",
      summary: "Calculate and rank competitive gaps using normative formula",
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
        { name: "days", in: "query", schema: { type: "integer", default: 7 } },
        { name: "engine", in: "query", schema: { type: "string" } },
        { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
        { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
        { name: "topic", in: "query", schema: { type: "string" } },
        { name: "nonBrandedOnly", in: "query", schema: { type: "boolean" } },
      ],
      responses: {
        "200": { description: "Ranked competitive gaps" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/candidates": {
    get: {
      operationId: "listCompetitorCandidates",
      summary: "List auto-discovered competitor candidates (frequency >= 10%)",
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
          schema: { type: "string", enum: ["suggested", "accepted", "rejected", "snoozed"] },
        },
      ],
      responses: {
        "200": { description: "List of auto-discovered candidate entities" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/candidates/discover": {
    post: {
      operationId: "runCompetitorDiscovery",
      summary: "Execute competitor auto-discovery algorithm across completed runs",
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
        "200": { description: "Auto-discovery results" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/candidates/{id}/accept": {
    post: {
      operationId: "acceptCompetitorCandidate",
      summary: "Accept candidate and track as competitor",
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
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": { description: "Candidate accepted and converted to competitor" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/candidates/{id}/reject": {
    post: {
      operationId: "rejectCompetitorCandidate",
      summary: "Reject candidate with 90-day cooldown",
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
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": { description: "Candidate rejected" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/candidates/{id}/snooze": {
    post: {
      operationId: "snoozeCompetitorCandidate",
      summary: "Snooze candidate for 30 days",
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
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": { description: "Candidate snoozed" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/{competitorId}/head-to-head": {
    get: {
      operationId: "getHeadToHead",
      summary: "Prompt-by-prompt head-to-head comparison (wins, losses, ties)",
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
          name: "competitorId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        { name: "days", in: "query", schema: { type: "integer", default: 7 } },
        { name: "engine", in: "query", schema: { type: "string" } },
        { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
        { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
        { name: "topic", in: "query", schema: { type: "string" } },
        { name: "nonBrandedOnly", in: "query", schema: { type: "boolean" } },
      ],
      responses: {
        "200": { description: "Head-to-head comparison" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/competitors/export": {
    get: {
      operationId: "exportCompetitors",
      summary: "Export leaderboard, head-to-head, or gaps in RFC 4180 CSV",
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
          name: "type",
          in: "query",
          required: true,
          schema: { type: "string", enum: ["leaderboard", "head_to_head", "gaps"] },
        },
        { name: "competitorId", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "days", in: "query", schema: { type: "integer", default: 7 } },
        { name: "engine", in: "query", schema: { type: "string" } },
        { name: "dateFrom", in: "query", schema: { type: "string", format: "date" } },
        { name: "dateTo", in: "query", schema: { type: "string", format: "date" } },
        { name: "topic", in: "query", schema: { type: "string" } },
        { name: "nonBrandedOnly", in: "query", schema: { type: "boolean" } },
      ],
      responses: {
        "200": { description: "CSV file download", content: { "text/csv": {} } },
      },
    },
  },
};
