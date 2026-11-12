const base = "/v1/tenants/{tenantId}/projects/{projectId}/monitoring";
const properties = {
  engine: {
    type: "string",
    enum: ["gemini", "openai", "google_ai_overviews", "google_ai_mode", "openrouter"],
    default: "gemini",
  },
  promptIds: {
    type: "array",
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
    items: { type: "string", format: "uuid" },
  },
  geos: { type: "array", default: ["US"], items: { type: "string", pattern: "^[A-Z]{2}$" } },
  languages: { type: "array", default: ["en"], items: { type: "string" } },
  samples: { type: "integer", minimum: 1, maximum: 5, default: 3 },
};
const params = ["tenantId", "projectId"].map((name) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
}));
const response = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { type: "object", required: ["statusCode", "success", "message", "data"] },
    },
  },
});
const body = (properties: Record<string, unknown>, required: string[]) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: false, properties, required },
    },
  },
});
function operation(
  id: string,
  description: string,
  write = false,
  requestBody?: unknown,
  extra: unknown[] = [],
  status = "200",
) {
  return {
    operationId: id,
    description,
    security: [write ? { accessCookie: [], csrfCookie: [], csrfHeader: [] } : { accessCookie: [] }],
    parameters: [...params, ...extra],
    ...(requestBody ? { requestBody } : {}),
    responses: {
      [status]: response(description),
      "400": response("Invalid input"),
      "401": response("Sign in required"),
      "402": response("Insufficient or unconfigured credits"),
      "403": response("CSRF rejected"),
      "404": response("Resource not found"),
      "409": response(
        "Inactive project, invalid schedule entitlement, or conflicting idempotency key",
      ),
      "429": response("Rate limit reached; Retry-After supplied"),
      "503": response("Monitoring disabled or a dependency unavailable"),
    },
  };
}
const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const pagination = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
  { name: "before", in: "query", schema: { type: "string", format: "uuid" } },
];
const promptPagination = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 100 },
  },
  { name: "before", in: "query", schema: { type: "string", format: "uuid" } },
  { name: "includeArchived", in: "query", schema: { type: "boolean", default: false } },
];
export const monitoringApiPaths = {
  [base + "/runs/stop-quota-retries"]: {
    post: operation(
      "stopQuotaRetries",
      "Stop queued quota failures requiring review and release their reserved monitoring credits without a provider request. Does not cancel other runs.",
      true,
    ),
  },
  [base + "/prompts/{id}/schedules/status"]: {
    post: operation(
      "changePromptMonitoringSchedules",
      "Pause, resume or remove this prompt in existing schedules. Other prompts and reserved runs are preserved. Resume respects paused schedules and inactive prompts; removed selections require a new schedule.",
      true,
      body({ status: { type: "string", enum: ["active", "paused", "deleted"] } }, ["status"]),
      [idParam],
    ),
  },
  [base + "/schedules/status"]: {
    post: operation(
      "changeProjectMonitoringSchedules",
      "Pause, resume or delete all Gemini schedules in this project",
      true,
      body({ status: { type: "string", enum: ["active", "paused", "deleted"] } }, ["status"]),
    ),
  },
  [base + "/engines"]: {
    get: operation(
      "monitoringEngines",
      "Configuration status across Gemini, OpenAI, Google AI Overviews, and Google AI Mode",
    ),
  },
  [base + "/canary"]: {
    post: operation(
      "canaryTestMonitoringEngine",
      "Explicit provider connection test. Provider charges may apply; no platform credits are deducted. Replay the same Idempotency-Key to retrieve the result without another provider call. An unconfirmed result is never automatically re-executed.",
      true,
      body(
        {
          engine: {
            type: "string",
            enum: ["gemini", "openai", "google_ai_overviews", "google_ai_mode", "openrouter"],
          },
        },
        ["engine"],
      ),
      [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", minLength: 8, maxLength: 100 },
        },
      ],
    ),
  },
  [base + "/prompts"]: {
    get: operation(
      "listMonitoringPrompts",
      "Monitoring prompts with visibility, citation and engine metrics",
      false,
      undefined,
      promptPagination,
    ),
    post: operation(
      "createMonitoringPrompt",
      "Create a monitoring prompt. Supply Idempotency-Key to safely retry a lost response; the same key and inputs return the original prompt, and changed inputs return 409.",
      true,
      body(
        {
          body: { type: "string", minLength: 1, maxLength: 4000 },
          persona: { type: "string", maxLength: 1000 },
          tags: {
            type: "array",
            maxItems: 10,
            items: { type: "string", minLength: 1, maxLength: 30 },
          },
        },
        ["body"],
      ),
      [
        {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,100}$" },
        },
      ],
      "201",
    ),
  },
  [base + "/prompts/{id}"]: {
    patch: operation(
      "updateMonitoringPrompt",
      "Update body/persona/tags and version, or pause/resume a prompt. Existing run snapshots do not change.",
      true,
      body(
        {
          body: { type: "string", minLength: 1, maxLength: 4000 },
          persona: { type: "string", maxLength: 1000 },
          tags: {
            type: "array",
            maxItems: 10,
            items: { type: "string", minLength: 1, maxLength: 30 },
          },
          active: { type: "boolean" },
        },
        [],
      ),
      [idParam],
    ),
  },
  [base + "/prompts/summary"]: {
    get: operation(
      "monitoringPromptSummary",
      "Prompt counts, answer volume over the last 30 days, and average observed brand visibility",
    ),
  },
  [base + "/prompts/suggestions"]: {
    get: operation(
      "suggestMonitoringPrompts",
      "Return local, non-billable prompt suggestions derived from the project brand and domain",
    ),
  },
  [base + "/prompts/import"]: {
    post: operation(
      "importMonitoringPrompts",
      "Import up to 100 prompts; case-insensitive duplicates are skipped. Supply Idempotency-Key to safely retry.",
      true,
      body(
        {
          prompts: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                body: { type: "string", minLength: 1, maxLength: 4000 },
                persona: { type: "string", maxLength: 1000 },
                tags: {
                  type: "array",
                  maxItems: 10,
                  items: { type: "string", minLength: 1, maxLength: 30 },
                },
              },
              required: ["body"],
            },
          },
        },
        ["prompts"],
      ),
      [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,100}$" },
        },
      ],
      "201",
    ),
  },
  [base + "/prompts/bulk"]: {
    post: operation(
      "updateMonitoringPrompts",
      "Pause, resume, archive, restore, or add a tag to up to 100 prompts",
      true,
      body(
        {
          promptIds: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            uniqueItems: true,
            items: { type: "string", format: "uuid" },
          },
          action: { type: "string", enum: ["pause", "resume", "archive", "restore", "add-tag"] },
          tag: { type: "string", minLength: 1, maxLength: 30 },
        },
        ["promptIds", "action"],
      ),
    ),
  },
  [base + "/prompts/{id}/versions"]: {
    get: operation(
      "monitoringPromptVersions",
      "Read version history for a monitoring prompt",
      false,
      undefined,
      [idParam],
    ),
  },
  [base + "/prompts/{id}/answers"]: {
    get: operation(
      "monitoringPromptAnswers",
      "Read recent answers and cited sources for a monitoring prompt",
      false,
      undefined,
      [idParam],
    ),
  },
  [base + "/schedules"]: {
    get: operation("listMonitoringSchedules", "Monitoring schedules", false, undefined, pagination),
    post: operation(
      "createMonitoringSchedule",
      "Create daily, weekly or custom fixed-interval schedule; defaults to one sample. Supply Idempotency-Key for safe retries: matching inputs return the original schedule; changed inputs return 409. The engine must be configured and the interval must satisfy entitlement.",
      true,
      body(
        {
          ...properties,
          samples: { type: "integer", minimum: 1, maximum: 5, default: 1 },
          cadence: { type: "string", enum: ["daily", "weekly", "custom"], default: "daily" },
          intervalMinutes: { type: "integer", minimum: 60, maximum: 43200 },
        },
        ["promptIds"],
      ),
      [
        {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,100}$" },
        },
      ],
      "201",
    ),
  },
  [base + "/schedules/{id}"]: {
    patch: operation(
      "changeMonitoringSchedule",
      "Pause or resume a schedule",
      true,
      body({ status: { type: "string", enum: ["active", "paused", "deleted"] } }, ["status"]),
      [idParam],
    ),
    delete: operation(
      "deleteMonitoringSchedule",
      "Soft delete a schedule; already reserved runs retain their history",
      true,
      undefined,
      [idParam],
    ),
  },
  [base + "/runs"]: {
    get: operation(
      "listMonitoringRuns",
      "Run history; use the last id as the next before cursor",
      false,
      undefined,
      pagination,
    ),
    post: operation(
      "createMonitoringRun",
      "Queue selected prompt/geo/language samples; max 500 runs. Reserves credits atomically. Same key and inputs returns existing runs; changed inputs returns 409. Use samples=1 for backfill.",
      true,
      body(properties, ["promptIds"]),
      [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,100}$" },
        },
      ],
      "202",
    ),
  },
  [base + "/runs/{id}"]: {
    get: operation(
      "getMonitoringRun",
      "Run metadata, normalized answer, citations, usage and evidence reference",
      false,
      undefined,
      [idParam],
    ),
  },
  [base + "/runs/{id}/evidence"]: {
    get: operation(
      "getMonitoringEvidence",
      "Owner-authorized redacted provider evidence. Content is untrusted; never render returned HTML directly.",
      false,
      undefined,
      [idParam],
    ),
  },
  [base + "/health"]: {
    get: operation(
      "monitoringHealth",
      "Backlog, seven-day success rate, last success and project credit use; null rate means no completed samples",
    ),
  },
  [base + "/events"]: {
    get: operation(
      "monitoringEvents",
      "Credit and run events, quota notifications and provider change flags",
      false,
      undefined,
      pagination,
    ),
  },
};
