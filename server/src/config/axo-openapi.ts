export const axoOpenApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/axo/policy": {
    get: {
      tags: ["Agent Experience Optimization (M16)"],
      summary: "Get Project Agent Policy (AXO-FR-003, AXO-FR-009)",
      description:
        "Retrieves the configured AI bot policy, robots.txt directives, and draft settings.",
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
        200: { description: "Agent policy retrieved successfully" },
        404: { description: "Project not found" },
      },
    },
    post: {
      tags: ["Agent Experience Optimization (M16)"],
      summary: "Save Project Agent Policy (AXO-FR-003, AXO-FR-009)",
      description: "Persists updated robots.txt rules, bot access flags, and draft specifications.",
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
              required: ["robotsTxtContent"],
              properties: {
                policyPreset: {
                  type: "string",
                  enum: ["search_only", "maximum_visibility", "strict_copyright", "custom"],
                  default: "search_only",
                },
                robotsTxtContent: { type: "string" },
                botRules: { type: "object", additionalProperties: { type: "boolean" } },
                trainingBotsDisallowed: { type: "boolean", default: true },
                searchBotsAllowed: { type: "boolean", default: true },
                customDirectives: { type: "string" },
                llmsTxtDraft: { type: "string" },
                llmsFullTxtDraft: { type: "string" },
                llmsValidation: { type: "object" },
                schemaTemplates: { type: "object" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Agent policy saved successfully" },
        400: { description: "Validation error" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/axo/llms/validate": {
    post: {
      tags: ["Agent Experience Optimization (M16)"],
      summary: "Live Validate /llms.txt and /llms-full.txt (AXO-FR-001, AXO-FR-002)",
      description:
        "Fetches and parses /llms.txt from the live domain with SSRF protection, scoring against the official specification.",
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
                targetUrl: {
                  type: "string",
                  format: "uri",
                  example: "https://example.com/llms.txt",
                },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "LLMS.txt validation completed" },
        400: { description: "Invalid URL or SSRF block" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/axo/robots/generate": {
    post: {
      tags: ["Agent Experience Optimization (M16)"],
      summary:
        "Generate Robots.txt AI Policy and Compute Diff (AXO-FR-003, AXO-FR-004, AXO-FR-005)",
      description:
        "Generates customized robots.txt directives separating search/grounding bots from training scrapers and compares against existing live rules.",
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
                preset: {
                  type: "string",
                  enum: ["search_only", "maximum_visibility", "strict_copyright", "custom"],
                  default: "search_only",
                },
                customBotRules: { type: "object", additionalProperties: { type: "boolean" } },
                customDirectives: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Robots.txt AI policy generated successfully" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/axo/drafts/generate": {
    post: {
      tags: ["Agent Experience Optimization (M16)"],
      summary:
        "Synthesize Draft /llms.txt and Schema.org Templates (AXO-FR-006, AXO-FR-007, AXO-FR-008)",
      description:
        "Generates draft /llms.txt, /llms-full.txt, and copy-pasteable Schema.org JSON-LD snippets from brand profile and M8 crawl data.",
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
        200: { description: "Drafts generated successfully" },
        404: { description: "Project not found" },
      },
    },
  },
};
