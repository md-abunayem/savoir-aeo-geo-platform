export const integrationsOpenApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/connections": {
    get: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "List Connected Providers (ITG-FR-010)",
      description:
        "Lists all integrated third-party platforms (GSC, GA4) with their connection status, scopes, and last sync timestamp.",
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
        200: { description: "Integration connections retrieved successfully" },
        404: { description: "Project not found" },
      },
    },
    post: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "Connect Integration Provider (ITG-FR-001, ITG-FR-002, ITG-FR-011)",
      description:
        "Connects Google Search Console or Google Analytics 4, storing credentials encrypted at rest with AES-256-GCM.",
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
              required: ["provider"],
              properties: {
                provider: {
                  type: "string",
                  enum: ["google_search_console", "google_analytics_4", "custom_webhook"],
                },
                externalPropertyId: { type: "string" },
                accessToken: { type: "string" },
                refreshToken: { type: "string" },
                scopes: { type: "array", items: { type: "string" } },
                metadata: { type: "object" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Provider connected successfully" },
        400: { description: "Validation failed" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/connections/{connectionId}": {
    delete: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "Disconnect Provider (ITG-FR-010)",
      description:
        "Disconnects an integrated provider and optionally purges imported performance facts.",
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
          name: "connectionId",
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
                purgeData: { type: "boolean", default: false },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Provider disconnected successfully" },
        404: { description: "Connection not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/connections/{connectionId}/sync": {
    post: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "Trigger Manual Data Sync (ITG-FR-001, ITG-FR-002)",
      description:
        "Executes an immediate manual synchronization of GSC search queries or GA4 traffic facts.",
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
          name: "connectionId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Sync executed successfully" },
        404: { description: "Connection not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/keys": {
    get: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "List Public API Keys (ITG-FR-005, ITG-FR-012)",
      description:
        "Lists generated tenant API keys with scoped permissions, rate limits, and last used timestamps.",
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
        200: { description: "API keys retrieved successfully" },
      },
    },
    post: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "Generate Public API Key (ITG-FR-005, ITG-FR-012)",
      description:
        "Creates a new live API key (sk_live_...). The raw secret key is returned only once at creation.",
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
              required: ["name"],
              properties: {
                name: { type: "string", minLength: 2, maxLength: 100 },
                scopes: { type: "array", items: { type: "string" } },
                rateLimitRpm: { type: "integer", minimum: 10, maximum: 600, default: 60 },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "API key created successfully" },
        400: { description: "Validation failed" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/keys/{keyId}": {
    delete: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "Revoke API Key (ITG-FR-005)",
      description: "Revokes a tenant API key immediately.",
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
          name: "keyId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "API key revoked successfully" },
        404: { description: "Key not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/webhooks": {
    get: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "List Outbound Webhooks (ITG-FR-006)",
      description: "Lists registered outbound webhook endpoints subscribed to key platform events.",
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
        200: { description: "Webhook endpoints retrieved successfully" },
      },
    },
    post: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "Register Outbound Webhook (ITG-FR-006)",
      description:
        "Registers an HMAC-SHA256 signed outbound webhook endpoint (X-Savoir-Signature).",
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
              required: ["url", "events"],
              properties: {
                url: { type: "string", format: "uri" },
                events: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "run.completed",
                      "action.verified",
                      "action.created",
                      "alert.created",
                      "audit.completed",
                      "traffic.synced",
                    ],
                  },
                },
                description: { type: "string", maxLength: 250 },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Webhook endpoint registered successfully" },
        400: { description: "Validation failed" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/webhooks/{webhookId}": {
    delete: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "Delete Outbound Webhook (ITG-FR-006)",
      description: "Deletes an outbound webhook endpoint.",
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
          name: "webhookId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Webhook endpoint deleted successfully" },
        404: { description: "Webhook not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/webhooks/{webhookId}/test": {
    post: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "Dispatch Test Webhook Event (ITG-FR-006)",
      description: "Dispatches a simulated test event with signature verification headers.",
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
          name: "webhookId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Test webhook dispatched successfully" },
        404: { description: "Webhook not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/traffic/overview": {
    get: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "AI Traffic Analytics Overview (TRF-FR-001, TRF-FR-002, TRF-FR-003, TRF-FR-008)",
      description:
        "Returns aggregated AI referral traffic KPIs, conversion multipliers, engine breakdowns, landing pages, and modeled correlation with mandatory disclosures.",
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
          name: "days",
          in: "query",
          schema: { type: "integer", enum: [7, 14, 30, 90], default: 30 },
        },
      ],
      responses: {
        200: { description: "AI traffic overview retrieved successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/integrations/traffic/gsc": {
    get: {
      tags: ["Integrations & AI Traffic Analytics (M14, M11)"],
      summary: "GSC Performance & Prompt Opportunities (TRF-FR-004, ITG-FR-001)",
      description:
        "Returns Google Search Console query performance data and extracted question queries for prompt monitoring suggestions.",
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
          name: "questionOnly",
          in: "query",
          schema: { type: "boolean", default: false },
        },
      ],
      responses: {
        200: { description: "GSC performance data retrieved successfully" },
      },
    },
  },
};
