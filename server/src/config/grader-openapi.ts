export const graderOpenApiPaths = {
  "/v1/grader/submit": {
    post: {
      tags: ["AI Search Grader (M19)"],
      summary: "Submit domain for free AI search grading (HG-01 to HG-03)",
      description:
        "Public endpoint requiring no authentication. Evaluates brand visibility on ChatGPT and Gemini with Turnstile CAPTCHA and per-IP/device abuse controls.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["brandName", "domain"],
              properties: {
                brandName: { type: "string", example: "Acme SaaS" },
                domain: { type: "string", example: "acme.io" },
                category: { type: "string", example: "Software & Technology" },
                country: { type: "string", default: "US", example: "US" },
                competitors: {
                  type: "array",
                  maxItems: 3,
                  items: {
                    type: "object",
                    required: ["name", "domain"],
                    properties: {
                      name: { type: "string" },
                      domain: { type: "string" },
                    },
                  },
                },
                turnstileToken: { type: "string" },
                deviceFingerprint: { type: "string" },
                forceRefresh: { type: "boolean", default: false },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Cached report returned",
        },
        202: {
          description: "Grader pipeline execution initiated",
        },
        400: { description: "Invalid domain or CAPTCHA validation failure" },
        429: { description: "Rate limit exceeded (3/day per IP/device)" },
        503: { description: "Global spend ceiling circuit breaker active" },
      },
    },
  },
  "/v1/grader/reports/{shareToken}": {
    get: {
      tags: ["AI Search Grader (M19)"],
      summary: "Get Grader report by share token (HG-09, HG-21)",
      parameters: [
        {
          name: "shareToken",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "128-bit unguessable share token",
        },
      ],
      responses: {
        200: { description: "Report details and metrics" },
        404: { description: "Report not found or expired" },
      },
    },
  },
  "/v1/grader/reports/{shareToken}/email": {
    post: {
      tags: ["AI Search Grader (M19)"],
      summary: "Email gate for saving report link and PDF export (HG-21, HG-22)",
      parameters: [
        {
          name: "shareToken",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "consent"],
              properties: {
                email: { type: "string", format: "email" },
                consent: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Email registered successfully" },
        400: { description: "Consent or valid email missing" },
        404: { description: "Report not found" },
      },
    },
  },
  "/v1/grader/reports/{shareToken}/convert": {
    post: {
      tags: ["AI Search Grader (M19)"],
      summary: "Convert Grader report into continuous monitoring project (HG-24, ONB-FR-013)",
      description:
        "Imports brand, domain, competitors, and prompts directly into the user's M1 onboarding draft.",
      parameters: [
        {
          name: "shareToken",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: { description: "Report data imported into onboarding draft" },
        401: { description: "Authentication required" },
        404: { description: "Report not found" },
      },
    },
  },
  "/v1/grader/reports/{shareToken}/pdf": {
    get: {
      tags: ["AI Search Grader (M19)"],
      summary: "Get downloadable PDF report data (HG-21)",
      parameters: [
        {
          name: "shareToken",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: { description: "PDF structured data" },
        404: { description: "Report not found" },
      },
    },
  },
};
