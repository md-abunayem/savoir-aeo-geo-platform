export const reportingOpenApiPaths = {
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/dashboard": {
    get: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "Get Executive Cross-Module Dashboard (RPT-FR-001, RPT-FR-002, RPT-FR-011)",
      description:
        "Returns unified executive summary metrics aggregating Visibility (M3), Citations (M6), Competitors (M7), Technical AEO (M8), Content (M9), Traffic (M11), and Actions (M10) with overall AEO Readiness Index.",
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
        200: { description: "Executive dashboard retrieved successfully" },
        404: { description: "Project not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/schedules": {
    get: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "List Report Schedules (RPT-FR-003)",
      description: "Lists configured recurring report schedules.",
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
        200: { description: "Report schedules retrieved successfully" },
      },
    },
    post: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "Create Report Schedule (RPT-FR-003, RPT-FR-005)",
      description: "Configures automated weekly or monthly executive reports with email delivery.",
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
              required: ["name", "frequency", "recipients"],
              properties: {
                name: { type: "string", minLength: 2, maxLength: 255 },
                frequency: { type: "string", enum: ["weekly", "monthly"] },
                dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
                dayOfMonth: { type: "integer", minimum: 1, maximum: 31 },
                recipients: { type: "array", items: { type: "string", format: "email" } },
                format: { type: "string", enum: ["pdf", "html", "csv"], default: "pdf" },
                sections: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Report schedule created successfully" },
        400: { description: "Validation failed" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/schedules/{scheduleId}": {
    delete: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "Delete Report Schedule",
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
          name: "scheduleId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Report schedule deleted successfully" },
        404: { description: "Schedule not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/reports": {
    get: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "List Generated Reports History",
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
        200: { description: "Generated reports retrieved successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/reports/generate": {
    post: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "Generate On-Demand Executive Report (RPT-FR-004, RPT-FR-005, RPT-FR-010)",
      description:
        "Generates an instant print-ready executive brief with optional email delivery via Brevo.",
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
                title: { type: "string" },
                dateWindowDays: { type: "integer", enum: [7, 14, 30, 90], default: 30 },
                format: { type: "string", enum: ["pdf", "html", "json"], default: "pdf" },
                recipients: { type: "array", items: { type: "string", format: "email" } },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Executive report generated successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/alerts/rules": {
    get: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "List Alert Rules (RPT-FR-006)",
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
        200: { description: "Alert rules retrieved successfully" },
      },
    },
    post: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "Configure Alert Rule (RPT-FR-006, RPT-FR-007)",
      description:
        "Configures real-time triggers for visibility drops, competitor overtakes, lost citations, and crawl blockages.",
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
              required: ["name", "ruleType", "threshold"],
              properties: {
                name: { type: "string" },
                ruleType: {
                  type: "string",
                  enum: [
                    "visibility_drop",
                    "competitor_overtake",
                    "lost_citation",
                    "crawl_blockage",
                  ],
                },
                threshold: { type: "object" },
                severity: { type: "string", enum: ["critical", "warning", "info"] },
                channels: { type: "array", items: { type: "string" } },
                emailRecipients: { type: "array", items: { type: "string" } },
                cooldownHours: { type: "integer", default: 24 },
              },
            },
          },
        },
      },
      responses: {
        201: { description: "Alert rule configured successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/alerts/rules/{ruleId}": {
    delete: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "Delete Alert Rule",
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
          name: "ruleId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Alert rule deleted successfully" },
        404: { description: "Rule not found" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/alerts/incidents": {
    get: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "List Alert Incidents (RPT-FR-008, RPT-FR-009)",
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
          schema: { type: "string", enum: ["active", "acknowledged", "resolved", "dismissed"] },
        },
        {
          name: "severity",
          in: "query",
          schema: { type: "string", enum: ["critical", "warning", "info"] },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 50 },
        },
      ],
      responses: {
        200: { description: "Alert incidents retrieved successfully" },
      },
    },
  },
  "/v1/tenants/{tenantId}/projects/{projectId}/reporting/alerts/incidents/{incidentId}": {
    patch: {
      tags: ["Reporting & Alerts (M13)"],
      summary: "Update Alert Incident Status (RPT-FR-009)",
      description:
        "Updates incident lifecycle state (acknowledged, resolved, dismissed) with resolution notes.",
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
          name: "incidentId",
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
              required: ["status"],
              properties: {
                status: { type: "string", enum: ["acknowledged", "resolved", "dismissed"] },
                notes: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Alert incident updated successfully" },
        404: { description: "Incident not found" },
      },
    },
  },
};
