const endpoint = (scope: string, description: string) => ({
  get: {
    tags: ["Public API"],
    summary: description,
    description: `Requires ${scope} or read scope. Project-scoped keys; configured per-key requests/minute plus 180 requests/minute per source IP.`,
    security: [{ publicApiKey: [] }],
    parameters: [
      { in: "path", name: "projectId", required: true, schema: { type: "string", format: "uuid" } },
    ],
    responses: {
      "200": { description: "Success envelope with data" },
      "401": { description: "Missing, expired, revoked, wrong-project, or incorrectly scoped key" },
      "400": { description: "Invalid parameters" },
      "429": { description: "Rate limited or rate limiter unavailable" },
    },
  },
});
export const publicApiPaths = {
  "/v1/public/projects/{projectId}/traffic": endpoint(
    "read:traffic",
    "Read traffic overview; optional days=1..365 (default 30)",
  ),
  "/v1/public/projects/{projectId}/actions": endpoint(
    "read:actions",
    "Read action list; supports limit, offset, status, category, and search",
  ),
};
