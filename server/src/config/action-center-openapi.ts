export const actionCenterOpenApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/actions": {
    get: {
      tags: ["Optimization Action Center (M10)"],
      summary: "List Action Items (ACT-FR-002, ACT-FR-006)",
      description:
        "Returns prioritized, deduplicated action items with category filters, sorting, and project-wide statistics.",
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
        { name: "category", in: "query", schema: { type: "string" } },
        { name: "sourceModule", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string" } },
        { name: "effort", in: "query", schema: { type: "string", enum: ["S", "M", "L"] } },
        { name: "owner", in: "query", schema: { type: "string" } },
        { name: "search", in: "query", schema: { type: "string" } },
        { name: "minPriority", in: "query", schema: { type: "number" } },
        { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        {
          name: "sortBy",
          in: "query",
          schema: { type: "string", enum: ["priority", "dueDate", "created"] },
        },
      ],
      responses: {
        200: { description: "Action items retrieved successfully" },
        404: { description: "Project not found" },
      },
    },
    post: {
      tags: ["Optimization Action Center (M10)"],
      summary: "Create Custom Action Item (ACT-FR-002)",
      description: "Creates a manual action item with modeled priority scoring.",
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
              required: ["title", "description", "category"],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                category: { type: "string" },
                impact: { type: "integer", minimum: 1, maximum: 10 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                effort: { type: "string", enum: ["S", "M", "L"] },
                owner: { type: "string" },
                dueDate: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Action item created successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/actions/harvest": {
    post: {
      tags: ["Optimization Action Center (M10)"],
      summary: "Harvest Findings Across Modules (ACT-FR-001, ACT-FR-004)",
      description:
        "Aggregates findings from M5, M6, M7, M8, M9, and M16, deduplicates with existing items, and calculates Modeled priority scores.",
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
        200: { description: "Findings harvested and converted to action items" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/actions/bulk": {
    patch: {
      tags: ["Optimization Action Center (M10)"],
      summary: "Bulk Update Action Items (ACT-FR-006)",
      description:
        "Updates status, owner, or dismiss reason across multiple action items in a single batch.",
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
              required: ["ids"],
              properties: {
                ids: { type: "array", items: { type: "string", format: "uuid" } },
                status: {
                  type: "string",
                  enum: ["backlog", "todo", "in_progress", "done", "dismissed"],
                },
                dismissReason: { type: "string" },
                owner: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Action items updated successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/actions/export/csv": {
    get: {
      tags: ["Optimization Action Center (M10)"],
      summary: "Export Actions as RFC 4180 CSV (ACT-FR-007)",
      description: "Exports filtered action items as a secure, injection-safe RFC 4180 CSV file.",
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
        { name: "category", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: { description: "CSV file download", content: { "text/csv": {} } },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/actions/{actionId}": {
    get: {
      tags: ["Optimization Action Center (M10)"],
      summary: "Get Action Item Details (ACT-FR-002)",
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
          name: "actionId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Action item retrieved successfully" },
        404: { description: "Action item not found" },
      },
    },
    patch: {
      tags: ["Optimization Action Center (M10)"],
      summary: "Update Action Item (ACT-FR-002, ACT-FR-006, ACT-FR-008)",
      description:
        "Updates status, owner, effort, or due date. Moving to 'done' triggers automated verification loop.",
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
          name: "actionId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  enum: ["backlog", "todo", "in_progress", "done", "dismissed"],
                },
                dismissReason: { type: "string" },
                owner: { type: "string" },
                dueDate: { type: "string", format: "date-time" },
                effort: { type: "string", enum: ["S", "M", "L"] },
                impact: { type: "integer", minimum: 1, maximum: 10 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Action item updated successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/actions/{actionId}/verify": {
    post: {
      tags: ["Optimization Action Center (M10)"],
      summary: "Trigger Closed-Loop Verification (ACT-FR-008)",
      description:
        "Probes live endpoints, schemas, or robots.txt directives to verify that a completed action resolved the issue.",
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
          name: "actionId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Verification check completed" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/actions/{actionId}/comments": {
    get: {
      tags: ["Optimization Action Center (M10)"],
      summary: "List Comments on Action Item (ACT-FR-002, ACT-FR-006)",
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
          name: "actionId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Comments retrieved successfully" },
      },
    },
    post: {
      tags: ["Optimization Action Center (M10)"],
      summary: "Add Comment to Action Item (ACT-FR-002, ACT-FR-006)",
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
          name: "actionId",
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
              required: ["body"],
              properties: {
                body: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Comment added successfully" },
      },
    },
  },
};
