const projectParameter = {
  name: "projectId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const errors = {
  "400": { description: "Invalid input or missing required fields" },
  "401": { description: "Authentication required" },
  "404": { description: "Project, delivery, or connection not found" },
  "429": { description: "Rate limited" },
  "503": { description: "Service temporarily unavailable" },
};

export const socialAnalyticsApiPaths = {
  "/v1/projects/{projectId}/performance-memory/ingest": {
    post: {
      tags: ["Performance Memory"],
      summary: "Ingest post performance statistics",
      description:
        "Records post engagement and conversion metrics into performance memory and recomputes the top 5% performing assets in the topic cluster.",
      parameters: [projectParameter],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["platform", "channelId", "topicCluster", "assetFormat", "hookText"],
              properties: {
                platform: {
                  type: "string",
                  enum: [
                    "facebook",
                    "instagram",
                    "x",
                    "tiktok",
                    "youtube",
                    "wordpress",
                    "reddit",
                    "other",
                  ],
                },
                channelId: { type: "string" },
                remotePostId: { type: "string" },
                topicCluster: { type: "string" },
                assetFormat: { type: "string" },
                hookStyle: { type: "string" },
                hookText: { type: "string" },
                audienceIntent: {
                  type: "string",
                  enum: ["awareness", "consideration", "decision", "retention", "educational"],
                },
                impressions: { type: "integer", default: 0 },
                reach: { type: "integer", default: 0 },
                likes: { type: "integer", default: 0 },
                shares: { type: "integer", default: 0 },
                comments: { type: "integer", default: 0 },
                clicks: { type: "integer", default: 0 },
                conversions: { type: "integer", default: 0 },
                conversionTag: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Performance record ingested successfully" },
        ...errors,
      },
    },
  },
  "/v1/projects/{projectId}/performance-memory/sync-buffer/{deliveryId}": {
    post: {
      tags: ["Performance Memory"],
      summary: "Poll Buffer API for published post metrics",
      description:
        "Fetches impressions, reach, likes, shares, comments, and clicks from Buffer GraphQL API and ingests them into performance memory.",
      parameters: [
        projectParameter,
        {
          name: "deliveryId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        "200": { description: "Buffer metrics synced successfully" },
        ...errors,
      },
    },
  },
  "/v1/projects/{projectId}/performance-memory/top": {
    get: {
      tags: ["Performance Memory"],
      summary: "Get top performing assets",
      description: "Retrieves top 5% performing assets filtered by topic cluster.",
      parameters: [
        projectParameter,
        {
          name: "cluster",
          in: "query",
          required: false,
          schema: { type: "string" },
          description: "Optional topic cluster name",
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", default: 5 },
        },
      ],
      responses: {
        "200": { description: "List of top performing assets" },
        ...errors,
      },
    },
  },
  "/v1/projects/{projectId}/performance-memory/patterns": {
    get: {
      tags: ["Performance Memory"],
      summary: "Get winning patterns for cluster (Strategy Feedback Loop)",
      description:
        "Returns synthesized strategy directives extracted from the top 5% performing assets in this topic cluster to inject into generation prompts.",
      parameters: [
        projectParameter,
        {
          name: "cluster",
          in: "query",
          required: false,
          schema: { type: "string" },
          description: "Topic cluster name",
        },
      ],
      responses: {
        "200": { description: "List of winning strategy directives" },
        ...errors,
      },
    },
  },
  "/v1/projects/{projectId}/performance-memory/summary": {
    get: {
      tags: ["Performance Memory"],
      summary: "Get cluster performance summary",
      description:
        "Aggregates performance by topic cluster, including top format, top hook style, and average engagement rate.",
      parameters: [projectParameter],
      responses: {
        "200": { description: "Cluster performance summary" },
        ...errors,
      },
    },
  },
};
