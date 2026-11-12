export const operatorOpenApiPaths = {
  "/v1/operator/tenants": {
    get: {
      tags: ["Internal Operator Administration (M15)"],
      summary: "Cross-Tenant Search & Directory (ADM-FR-008)",
      description:
        "Searches and filters customer tenants by name, plan tier, status, credit balance, and project count.",
      parameters: [
        { name: "X-Operator-Key", in: "header", required: true, schema: { type: "string" } },
        { name: "query", in: "query", schema: { type: "string" } },
        {
          name: "planTier",
          in: "query",
          schema: { type: "string", enum: ["starter", "growth", "enterprise", "all"] },
        },
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["active", "paused", "archived", "all"] },
        },
        { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
        { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
      ],
      responses: {
        200: { description: "Tenants list retrieved successfully" },
        401: { description: "Missing operator credentials" },
        403: { description: "Forbidden" },
      },
    },
  },
  "/v1/operator/tenants/{tenantId}": {
    get: {
      tags: ["Internal Operator Administration (M15)"],
      summary: "Get Deep Tenant Profile (ADM-FR-008)",
      description:
        "Returns deep operational details for a target tenant: projects, subscriptions, balances, and history.",
      parameters: [
        { name: "X-Operator-Key", in: "header", required: true, schema: { type: "string" } },
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Tenant details retrieved successfully" },
        404: { description: "Tenant not found" },
      },
    },
  },
  "/v1/operator/tenants/{tenantId}/status": {
    post: {
      tags: ["Internal Operator Administration (M15)"],
      summary: "Update Tenant Status (Pause / Resume / Archive) (ADM-FR-009)",
      description: "Pauses or resumes tenant operations with mandatory operational audit logging.",
      parameters: [
        { name: "X-Operator-Key", in: "header", required: true, schema: { type: "string" } },
        {
          name: "tenantId",
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
              required: ["status", "reason"],
              properties: {
                status: { type: "string", enum: ["active", "paused", "archived"] },
                reason: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Tenant status updated successfully" },
        404: { description: "Tenant not found" },
      },
    },
  },
  "/v1/operator/tenants/{tenantId}/credits": {
    post: {
      tags: ["Internal Operator Administration (M15)"],
      summary: "Manual Credit Adjustment (ADM-FR-010)",
      description:
        "Manually adjusts monitoring or crawl credits for a customer tenant with immutable audit logging.",
      parameters: [
        { name: "X-Operator-Key", in: "header", required: true, schema: { type: "string" } },
        {
          name: "tenantId",
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
              required: ["category", "amount", "reason"],
              properties: {
                category: { type: "string", enum: ["monitoring", "crawl"] },
                amount: { type: "integer" },
                reason: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Credits adjusted successfully" },
        400: { description: "Invalid amount or parameters" },
      },
    },
  },
  "/v1/operator/queues": {
    get: {
      tags: ["Internal Operator Administration (M15)"],
      summary: "Get Platform Queue Health (ADM-FR-011)",
      description:
        "Returns health statistics and backlog depths across monitoring, grader, crawler, and email queues.",
      parameters: [
        { name: "X-Operator-Key", in: "header", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: { description: "Queue health statistics retrieved" },
      },
    },
  },
  "/v1/operator/audit-logs": {
    get: {
      tags: ["Internal Operator Administration (M15)"],
      summary: "Query Operator Audit Logs (ADM-FR-012)",
      description: "Returns immutable administrative action history.",
      parameters: [
        { name: "X-Operator-Key", in: "header", required: true, schema: { type: "string" } },
        { name: "targetTenantId", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
      ],
      responses: {
        200: { description: "Operator audit logs retrieved" },
      },
    },
  },
};
