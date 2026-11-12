import { z } from "zod";
import {
  modelJsonSchema,
  studioDocumentSchema,
  studioInputSchema,
} from "../services/content/content-studio.schema.js";
import {
  mediaInputSchema,
  revisionSchema,
  scheduleSchema,
} from "../services/publishing/publishing.validation.js";
const project = {
  name: "projectId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const id = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
function operation(
  operationId: string,
  description: string,
  schema?: unknown,
  parameters: unknown[] = [project],
) {
  return {
    operationId,
    description,
    tags: ["Content Studio"],
    security: [{ accessCookie: [] }],
    parameters: [
      ...parameters,
      ...(schema
        ? [{ name: "X-CSRF-Token", in: "header", required: true, schema: { type: "string" } }]
        : []),
    ],
    ...(schema
      ? { requestBody: { required: true, content: { "application/json": { schema } } } }
      : {}),
    responses: {
      "200": { description: "Operation complete; response envelope data contains the result" },
      "201": { description: "Draft or upload created" },
      "400": { description: "Invalid input" },
      "401": { description: "Authentication required" },
      "403": { description: "Invalid CSRF token" },
      "404": { description: "Project or draft not owned by this user" },
      "409": { description: "Stale revision, failed validation or illegal state transition" },
      "429": { description: "Rate limited" },
      "503": { description: "Required service is not configured or available" },
    },
  };
}
const root = "/v1/projects/{projectId}/studio";
export const studioApiPaths = {
  [root]: {
    get: operation(
      "getContentStudio",
      "List the latest 50 drafts, public media, connection metadata and delivery notifications. Credentials are never returned.",
    ),
  },
  [`${root}/generate`]: {
    post: operation(
      "generateStudioDraft",
      "Generate all formats using approved memory; store an unapproved draft and validation report.",
      modelJsonSchema(studioInputSchema),
    ),
  },
  [`${root}/drafts`]: {
    post: operation(
      "importStudioDraft",
      "Import an unapproved draft. Client-supplied approval and validation fields are rejected.",
      modelJsonSchema(z.object({ document: studioDocumentSchema }).strict()),
    ),
  },
  [`${root}/drafts/{id}`]: {
    put: operation(
      "editStudioDraft",
      "Save a new revision, reset validation and clear approval. Scheduled/published revisions cannot be edited.",
      modelJsonSchema(revisionSchema.extend({ document: studioDocumentSchema })),
      [project, id],
    ),
  },
  [`${root}/drafts/{id}/review`]: {
    post: operation(
      "reviewStudioDraft",
      "Run fresh fact checking and enter in_review for the exact revision.",
      modelJsonSchema(revisionSchema),
      [project, id],
    ),
  },
  [`${root}/drafts/{id}/approve`]: {
    post: operation(
      "approveStudioDraft",
      "Record human approval of a saved in_review revision with a passed server-side validation report.",
      modelJsonSchema(revisionSchema),
      [project, id],
    ),
  },
  [`${root}/drafts/{id}/schedule`]: {
    post: operation(
      "scheduleStudioDraft",
      "Schedule an approved revision from 30 seconds to one year in the future. PostgreSQL owns the durable outbox; the publishing worker dispatches at scheduled_time.",
      modelJsonSchema(scheduleSchema),
      [project, id],
    ),
  },
  [`${root}/connections/{provider}`]: {
    post: operation(
      "connectStudioPublisher",
      "Verify a Buffer access token or WordPress Application Password and encrypt it at rest. WordPress requires the Savoir Article Schema plugin.",
      {
        oneOf: [
          {
            type: "object",
            required: ["accessToken"],
            additionalProperties: false,
            properties: { accessToken: { type: "string", writeOnly: true } },
          },
          {
            type: "object",
            required: ["siteUrl", "username", "applicationPassword"],
            additionalProperties: false,
            properties: {
              siteUrl: { type: "string", format: "uri" },
              username: { type: "string" },
              applicationPassword: { type: "string", writeOnly: true },
            },
          },
        ],
      },
      [
        project,
        {
          name: "provider",
          in: "path",
          required: true,
          schema: { type: "string", enum: ["buffer", "wordpress"] },
        },
      ],
    ),
  },
  [`${root}/media`]: {
    post: operation(
      "prepareStudioMedia",
      "Prepare a 15-minute signed upload for a pending object, up to 100 MiB. Upload bytes with PUT, Content-Type and Cache-Control: public, max-age=31536000, immutable.",
      modelJsonSchema(mediaInputSchema),
    ),
  },
  [`${root}/media/{id}/complete`]: {
    post: operation(
      "completeStudioMedia",
      "Validate uploaded type/size, copy to an immutable public key, and mark media ready.",
      modelJsonSchema(z.object({}).strict()),
      [project, id],
    ),
  },
};
