export const billingOpenApiPaths = {
  "/v1/billing/webhook": {
    post: {
      tags: ["Platform Billing & Stripe (M15)"],
      summary: "Stripe Subscription & Checkout Webhooks (ADM-FR-004, ADM-FR-006)",
      description:
        "Processes incoming Stripe events (checkout.session.completed, invoice.paid, customer.subscription.updated/deleted) with HMAC-SHA256 signature verification.",
      parameters: [
        {
          name: "stripe-signature",
          in: "header",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: { description: "Webhook event processed successfully" },
        400: { description: "Invalid signature or payload" },
      },
    },
  },
  "/v1/billing/tenants/{tenantId}/overview": {
    get: {
      tags: ["Platform Billing & Stripe (M15)"],
      summary: "Get Tenant Billing Overview (ADM-FR-001, ADM-FR-004)",
      description:
        "Returns active subscription details, monitoring credits, crawl credits, available plan tiers, and recent ledger entries.",
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Billing overview retrieved successfully" },
        404: { description: "Tenant not found" },
      },
    },
  },
  "/v1/billing/tenants/{tenantId}/checkout": {
    post: {
      tags: ["Platform Billing & Stripe (M15)"],
      summary: "Create Stripe Checkout Session (ADM-FR-004)",
      description:
        "Creates a Stripe checkout session for subscription upgrades/downgrades or one-time credit top-up packs.",
      parameters: [
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
              required: ["planTier", "returnUrl"],
              properties: {
                planTier: {
                  type: "string",
                  enum: ["starter", "growth", "enterprise", "topup_1000"],
                },
                returnUrl: { type: "string", format: "uri" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Checkout session created successfully" },
        400: { description: "Validation error" },
      },
    },
  },
  "/v1/billing/tenants/{tenantId}/portal": {
    post: {
      tags: ["Platform Billing & Stripe (M15)"],
      summary: "Create Stripe Customer Portal Session (ADM-FR-005)",
      description:
        "Creates a self-serve Stripe customer billing portal session to manage payment methods, download invoices, and update billing details.",
      parameters: [
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
              required: ["returnUrl"],
              properties: {
                returnUrl: { type: "string", format: "uri" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Portal session created successfully" },
        400: { description: "No Stripe customer found" },
      },
    },
  },
  "/v1/billing/tenants/{tenantId}/ledger": {
    get: {
      tags: ["Platform Billing & Stripe (M15)"],
      summary: "Query Credit Ledger Entries (ADM-FR-002, ADM-FR-003)",
      description:
        "Returns the immutable credit transaction history for monitoring runs and crawl operations with balance after.",
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "category",
          in: "query",
          schema: { type: "string", enum: ["monitoring", "crawl"] },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 50 },
        },
        {
          name: "offset",
          in: "query",
          schema: { type: "integer", default: 0 },
        },
      ],
      responses: {
        200: { description: "Credit ledger entries retrieved successfully" },
      },
    },
  },
};
