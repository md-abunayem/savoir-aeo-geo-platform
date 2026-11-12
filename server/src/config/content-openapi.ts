export const contentOpenApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/content/inventory": {
    get: {
      tags: ["Content Intelligence (M9)"],
      summary: "List Content Inventory (CNT-FR-001)",
      description:
        "Returns paginated owned pages mapped to prompt clusters, AEO content scores, and cannibalization flags.",
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
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        { name: "isStale", in: "query", schema: { type: "boolean" } },
        { name: "search", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: { description: "Content inventory retrieved successfully" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/content/inventory/sync": {
    post: {
      tags: ["Content Intelligence (M9)"],
      summary: "Sync Content Inventory from Crawl Data (CNT-FR-001, CNT-FR-006, CNT-FR-007)",
      description:
        "Maps crawled pages to prompt clusters, evaluates AEO content scores, and flags cannibalization and staleness.",
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
        200: { description: "Content inventory synchronized successfully" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/content/gaps": {
    get: {
      tags: ["Content Intelligence (M9)"],
      summary: "List Content Gaps (CNT-FR-002)",
      description:
        "Retrieves identified prompts with low brand visibility and no strongly matching owned page.",
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
          schema: { type: "string", enum: ["open", "in_brief", "resolved", "dismissed"] },
        },
        { name: "minPriority", in: "query", schema: { type: "number" } },
      ],
      responses: {
        200: { description: "Content gaps retrieved successfully" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/content/gaps/identify": {
    post: {
      tags: ["Content Intelligence (M9)"],
      summary: "Identify New Content Gaps (CNT-FR-002)",
      description:
        "Scans monitoring prompts and correlates with content inventory and competitor citations to identify unaddressed topics.",
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
        200: { description: "Content gaps identified successfully" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/content/compare": {
    post: {
      tags: ["Content Intelligence (M9)"],
      summary: "Compare Owned Page vs Cited Competitor (CNT-FR-004)",
      description:
        "Compares an owned page against a top cited competitor page to reveal content and structural differences.",
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
              required: ["ownedUrl", "competitorUrl"],
              properties: {
                ownedUrl: { type: "string", format: "uri" },
                competitorUrl: { type: "string", format: "uri" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Page comparison completed successfully" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/content/briefs": {
    post: {
      tags: ["Content Intelligence (M9)"],
      summary: "Generate Content Brief (CNT-FR-005, CNT-FR-008, CNT-FR-009)",
      description:
        "Synthesizes an answer-first content brief with target questions, outline, entities, facts, and schema suggestions.",
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
              required: ["targetPrompts"],
              properties: {
                gapId: { type: "string", format: "uuid" },
                targetPrompts: { type: "array", items: { type: "string" }, minItems: 1 },
                primaryIntent: {
                  type: "string",
                  enum: ["informational", "commercial", "comparison", "troubleshooting"],
                },
                title: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Content brief created successfully" },
        404: { description: "Project not found" },
      },
    },
    get: {
      tags: ["Content Intelligence (M9)"],
      summary: "List Content Briefs",
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
        200: { description: "Content briefs retrieved successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/content/briefs/{briefId}": {
    get: {
      tags: ["Content Intelligence (M9)"],
      summary: "Get Specific Content Brief",
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
        { name: "briefId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
      responses: {
        200: { description: "Content brief retrieved successfully" },
        404: { description: "Brief not found" },
      },
    },
    patch: {
      tags: ["Content Intelligence (M9)"],
      summary: "Update Content Brief",
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
        { name: "briefId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                markdownContent: { type: "string" },
                status: { type: "string", enum: ["draft", "in_review", "ready", "exported"] },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Content brief updated successfully" },
        404: { description: "Brief not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/content/briefs/{briefId}/export": {
    get: {
      tags: ["Content Intelligence (M9)"],
      summary: "Export Content Brief (CNT-F1: Markdown / DOCX)",
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
        { name: "briefId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        {
          name: "format",
          in: "query",
          schema: { type: "string", enum: ["markdown", "docx"], default: "markdown" },
        },
      ],
      responses: {
        200: { description: "Exported brief file" },
        404: { description: "Brief not found" },
      },
    },
  },
};
