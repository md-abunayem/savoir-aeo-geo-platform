export const technicalOpenApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/technical/audits": {
    post: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Trigger Site-Side Technical AEO Audit (TEC-FR-001, TEC-FR-002)",
      description:
        "Initiates a polite site crawl (max 2 req/s) inspecting AI bot access (GPTBot, ClaudeBot, etc.), indexability, Schema.org validation, and answer-first structure.",
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
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                crawlType: {
                  type: "string",
                  enum: ["single_page", "key_pages", "full_site"],
                  default: "full_site",
                },
                pagesLimit: { type: "integer", minimum: 1, maximum: 500, default: 500 },
                targetDomain: { type: "string", example: "example.com" },
              },
            },
          },
        },
      },
      responses: {
        202: { description: "Technical audit initiated" },
        400: { description: "Invalid project domain or parameters" },
        404: { description: "Project not found" },
        409: { description: "An audit is already running for this project" },
      },
    },
    get: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "List Technical Audit History (TEC-FR-013)",
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
        { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
      ],
      responses: {
        200: { description: "List of technical audits" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/technical/audits/latest": {
    get: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Get Latest Technical Audit Overview (TEC-FR-010, TEC-FR-016)",
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
        200: { description: "Latest technical audit details or null" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/technical/audits/schedule": {
    get: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Get the recurring technical audit schedule",
      responses: {
        200: { description: "Current schedule or null" },
      },
    },
    put: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Create or update a recurring technical audit schedule",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["frequency"],
              properties: {
                frequency: {
                  type: "string",
                  enum: ["daily", "weekly", "monthly"],
                },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Saved recurring audit schedule" },
      },
    },
    delete: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Remove the recurring technical audit schedule",
      responses: {
        200: { description: "Schedule removed" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/technical/audits/{auditId}": {
    get: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Get Technical Audit by ID",
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
        { name: "auditId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        200: { description: "Technical audit overview with category scores and bot matrix" },
        404: { description: "Audit not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/technical/audits/{auditId}/pages": {
    get: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Get Crawled Audit Pages (TEC-FR-012)",
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
        { name: "auditId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        { name: "indexableOnly", in: "query", schema: { type: "boolean" } },
        { name: "search", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: { description: "Paginated list of crawled pages with individual scores" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/technical/audits/{auditId}/issues": {
    get: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Get Audit Issues with Fix Snippets (TEC-FR-011)",
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
        { name: "auditId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "category", in: "query", schema: { type: "string" } },
        { name: "severity", in: "query", schema: { type: "string" } },
        { name: "search", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: { description: "List of categorized and prioritized technical issues" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/technical/audits/{auditId}/issues/{issueId}": {
    patch: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Update a technical audit finding status",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status"],
              properties: {
                status: {
                  type: "string",
                  enum: ["open", "fixed", "dismissed"],
                },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Finding status updated" },
        404: { description: "Audit or finding not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/technical/audits/{auditId}/export": {
    get: {
      tags: ["Technical AEO Auditing (M8)"],
      summary: "Export Audit Pages or Issues as CSV (TEC-FR-014)",
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
        { name: "auditId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        {
          name: "type",
          in: "query",
          schema: { type: "string", enum: ["pages", "issues"], default: "issues" },
        },
      ],
      responses: {
        200: {
          description: "RFC 4180 CSV export file",
          content: { "text/csv": {} },
        },
      },
    },
  },
};
