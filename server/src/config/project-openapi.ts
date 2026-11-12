export const projectApiPaths = {
  "/v1/projects": {
    get: {
      operationId: "listOwnedProjects",
      description:
        "Read-only project discovery for the authenticated verified Owner. No project creation or onboarding.",
      security: [{ accessCookie: [] }],
      parameters: [
        { name: "after", in: "query", schema: { type: "string", format: "uuid" } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        "200": {
          description: "Owned projects and next cursor",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  data: {
                    type: "object",
                    required: ["projects", "nextCursor"],
                    properties: {
                      projects: {
                        type: "array",
                        items: {
                          type: "object",
                          required: [
                            "id",
                            "tenantId",
                            "tenantName",
                            "brandName",
                            "domain",
                            "status",
                          ],
                          properties: {
                            id: { type: "string", format: "uuid" },
                            tenantId: { type: "string", format: "uuid" },
                            tenantName: { type: "string" },
                            brandName: { type: "string" },
                            domain: { type: "string" },
                            status: { type: "string", enum: ["draft", "active", "archived"] },
                          },
                        },
                      },
                      nextCursor: { type: ["string", "null"], format: "uuid" },
                    },
                  },
                },
              },
            },
          },
        },
        "400": { description: "Invalid pagination" },
        "401": { description: "Sign in required" },
        "429": { description: "Rate limited" },
        "503": { description: "Dependency unavailable" },
      },
    },
  },
};
