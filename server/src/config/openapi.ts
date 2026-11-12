import { projectApiPaths } from "./project-openapi.js";
import { qaApiPaths } from "./qa-openapi.js";
import { studioApiPaths } from "./studio-openapi.js";
import { socialAnalyticsApiPaths } from "./social-analytics-openapi.js";
import { publicApiPaths } from "./public-api-openapi.js";
import { monitoringApiPaths } from "./monitoring-openapi.js";
import { onboardingApiPaths } from "./onboarding-openapi.js";
import { answerApiPaths } from "./answer-openapi.js";
import { visibilityApiPaths } from "./visibility-openapi.js";
import { citationApiPaths } from "./citation-openapi.js";
import { competitorApiPaths } from "./competitor-openapi.js";
import { graderOpenApiPaths } from "./grader-openapi.js";
import { technicalOpenApiPaths } from "./technical-openapi.js";
import { axoOpenApiPaths } from "./axo-openapi.js";
import { contentOpenApiPaths } from "./content-openapi.js";
import { actionCenterOpenApiPaths } from "./action-center-openapi.js";
import { integrationsOpenApiPaths } from "./integrations-openapi.js";
import { reportingOpenApiPaths } from "./reporting-openapi.js";
import { billingOpenApiPaths } from "./billing-openapi.js";
import { operatorOpenApiPaths } from "./operator-openapi.js";
import {
  authApiPaths,
  authSecuritySchemes,
  registrationApiPaths,
  passwordResetApiPaths,
} from "./auth-openapi.js";
const envelope = (status: "alive" | "ready" | "not_ready") => ({
  type: "object",
  required: ["statusCode", "message", "success", "data"],
  properties: {
    statusCode: { type: "integer" },
    message: { type: "string" },
    success: { type: "boolean" },
    data: { type: "object", required: ["status"], properties: { status: { const: status } } },
  },
});
const response = (description: string, status: "alive" | "ready" | "not_ready") => ({
  description,
  headers: { "X-Request-Id": { schema: { type: "string", format: "uuid" } } },
  content: { "application/json": { schema: envelope(status) } },
});
const internalError = {
  description: "Unexpected server error",
  content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
};
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Savoir Backend API",
    version: "0.1.0",
    description:
      "Foundation and optional verified-account session endpoints. Other product modules remain pending.",
  },
  paths: {
    "/v1/health/live": {
      get: {
        operationId: "liveness",
        responses: { "200": response("API process is alive", "alive") },
      },
    },
    "/v1/health/ready": {
      get: {
        operationId: "readiness",
        responses: {
          "200": response("Required services are available", "ready"),
          "503": response("Starting, draining, or a dependency is unavailable", "not_ready"),
          "500": internalError,
        },
      },
    },
  },
  components: {
    schemas: {
      Problem: {
        type: "object",
        required: ["type", "title", "status", "detail", "code", "requestId"],
        properties: {
          type: { type: "string", format: "uri" },
          title: { type: "string" },
          status: { type: "integer" },
          detail: { type: "string" },
          code: { type: "string" },
          requestId: { type: "string", format: "uuid" },
        },
      },
    },
  },
};

export function getOpenApiDocument(
  authEnabled: boolean,
  registrationEnabled = false,
  passwordResetEnabled = false,
  monitoringEnabled = false,
  projectsEnabled = false,
  onboardingEnabled = false,
  publicApiEnabled = false,
  qaEnabled = false,
  studioEnabled = false,
) {
  return {
    ...openApiDocument,
    paths: {
      ...openApiDocument.paths,
      ...(publicApiEnabled ? publicApiPaths : {}),
      ...(authEnabled && projectsEnabled ? projectApiPaths : {}),
      ...(authEnabled && qaEnabled ? qaApiPaths : {}),
      ...(authEnabled && studioEnabled ? studioApiPaths : {}),
      ...(authEnabled ? socialAnalyticsApiPaths : {}),
      ...(authEnabled && monitoringEnabled ? monitoringApiPaths : {}),
      ...(authEnabled && onboardingEnabled ? onboardingApiPaths : {}),
      ...(authEnabled ? answerApiPaths : {}),
      ...(authEnabled ? visibilityApiPaths : {}),
      ...(authEnabled ? citationApiPaths : {}),
      ...(authEnabled ? competitorApiPaths : {}),
      ...(authEnabled ? technicalOpenApiPaths : {}),
      ...(authEnabled ? axoOpenApiPaths : {}),
      ...(authEnabled ? contentOpenApiPaths : {}),
      ...(authEnabled ? actionCenterOpenApiPaths : {}),
      ...(authEnabled ? integrationsOpenApiPaths : {}),
      ...(authEnabled ? reportingOpenApiPaths : {}),
      ...(authEnabled ? billingOpenApiPaths : {}),
      ...operatorOpenApiPaths,
      ...graderOpenApiPaths,
      ...(authEnabled ? authApiPaths : {}),
      ...(authEnabled && registrationEnabled ? registrationApiPaths : {}),
      ...(authEnabled && passwordResetEnabled ? passwordResetApiPaths : {}),
    },
    components: {
      ...openApiDocument.components,
      securitySchemes: {
        ...(authEnabled ? authSecuritySchemes : {}),
        ...(publicApiEnabled
          ? { publicApiKey: { type: "http", scheme: "bearer", bearerFormat: "Project API key" } }
          : {}),
      },
    },
  };
}
