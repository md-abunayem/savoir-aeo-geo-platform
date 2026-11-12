export const onboardingApiPaths = {
  "/v1/auth/google/url": {
    get: {
      tags: ["Authentication"],
      summary: "Get Google OAuth authorization URL with PKCE",
      responses: {
        "200": {
          description: "Google OAuth URL and state",
        },
      },
    },
  },
  "/v1/auth/google/callback": {
    post: {
      tags: ["Authentication"],
      summary: "Exchange Google OAuth code with PKCE verification and sign in",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["code", "state"],
              properties: {
                code: { type: "string" },
                state: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Google sign-in completed" },
        "400": { description: "Invalid code or state" },
      },
    },
  },
  "/v1/onboarding/draft": {
    get: {
      tags: ["Onboarding"],
      summary: "Retrieve current onboarding draft",
      security: [{ sessionAuth: [] }],
      responses: {
        "200": { description: "Draft retrieved" },
        "401": { description: "Unauthorized" },
      },
    },
    put: {
      tags: ["Onboarding"],
      summary: "Save onboarding draft progress",
      security: [{ sessionAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["step", "data"],
              properties: {
                step: { type: "integer", minimum: 1, maximum: 4 },
                data: { type: "object" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Draft saved" },
        "401": { description: "Unauthorized" },
      },
    },
    delete: {
      tags: ["Onboarding"],
      summary: "Discard onboarding draft",
      security: [{ sessionAuth: [] }],
      responses: {
        "200": { description: "Draft deleted" },
        "401": { description: "Unauthorized" },
      },
    },
  },
  "/v1/onboarding/analyze-domain": {
    post: {
      tags: ["Onboarding"],
      summary: "Analyze domain and extract brand profile (Step 1)",
      security: [{ sessionAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["domain"],
              properties: {
                domain: { type: "string" },
                brandName: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Domain analyzed and brand profile extracted" },
        "400": { description: "Invalid domain or SSRF blocked" },
        "409": { description: "Domain already registered" },
      },
    },
  },
  "/v1/onboarding/generate-seeds": {
    post: {
      tags: ["Onboarding"],
      summary: "Generate competitors, markets and seed prompts (Step 2)",
      security: [{ sessionAuth: [] }],
      responses: {
        "200": { description: "Seed prompts and competitors generated" },
      },
    },
  },
  "/v1/onboarding/estimate-costs": {
    post: {
      tags: ["Onboarding"],
      summary: "Estimate monthly credit consumption and plan limits (Step 3)",
      security: [{ sessionAuth: [] }],
      responses: {
        "200": { description: "Cost estimation calculated" },
      },
    },
  },
  "/v1/onboarding/activate": {
    post: {
      tags: ["Onboarding"],
      summary:
        "Atomically create workspace/tenant, project and enqueue first monitoring run (Step 4)",
      security: [{ sessionAuth: [] }],
      responses: {
        "201": { description: "Project activated and monitoring enqueued" },
        "400": { description: "Invalid project setup" },
      },
    },
  },
};
