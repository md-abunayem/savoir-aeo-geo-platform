const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
});
const success = (description: string) => ({
  description,
  headers: { "Cache-Control": { schema: { const: "no-store" } } },
  content: {
    "application/json": {
      schema: { type: "object", required: ["statusCode", "success", "message", "data"] },
    },
  },
});
const csrf = { csrfHeader: [], csrfCookie: [] };
export const authSecuritySchemes = {
  accessCookie: { type: "apiKey", in: "cookie", name: "savoir_access" },
  refreshCookie: { type: "apiKey", in: "cookie", name: "savoir_refresh" },
  csrfHeader: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
  csrfCookie: { type: "apiKey", in: "cookie", name: "savoir_csrf" },
};
export const authApiPaths = {
  "/v1/auth/csrf": {
    get: {
      operationId: "issueCsrfToken",
      description:
        "Returns a signed CSRF token and matching cookie; send both on authentication POST requests.",
      responses: { "200": success("CSRF token issued") },
    },
  },
  "/v1/auth/login": {
    post: {
      operationId: "login",
      description: "Email/password login for verified, enabled users.",
      security: [csrf],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["email", "password"],
              properties: {
                email: { type: "string", format: "email", maxLength: 255 },
                password: { type: "string", description: "At most 72 UTF-8 bytes", minLength: 1 },
              },
            },
          },
        },
      },
      responses: {
        "200": success("Signed in; access/refresh tokens are set only as HttpOnly cookies"),
        "400": problem("Invalid input"),
        "401": problem("Invalid credentials or account unavailable"),
        "403": problem("CSRF rejected"),
        "429": problem("Rate limited; Retry-After is supplied"),
        "503": problem("Authentication limiter unavailable"),
      },
    },
  },
  "/v1/auth/refresh": {
    post: {
      operationId: "refreshSession",
      security: [{ ...csrf, refreshCookie: [] }],
      description:
        "Rotates refresh tokens. Reuse revokes the entire session family. Clients must serialize refresh requests.",
      responses: {
        "200": success("Cookies renewed"),
        "401": problem("Expired, invalid, or reused refresh token"),
        "403": problem("CSRF rejected"),
        "429": problem("Rate limited"),
      },
    },
  },
  "/v1/auth/logout": {
    post: {
      operationId: "logout",
      security: [csrf],
      responses: {
        "200": success("Session family revoked and cookies cleared"),
        "403": problem("CSRF rejected"),
        "429": problem("Rate limited"),
      },
    },
  },
  "/v1/auth/me": {
    get: {
      operationId: "currentUser",
      security: [{ accessCookie: [] }],
      responses: {
        "200": success("Current user id, name and email"),
        "401": problem("Authentication required or session revoked"),
      },
    },
  },
};

const lifecycleBody = (properties: Record<string, unknown>, required: string[]) => ({
  required: true,
  content: {
    "application/json": {
      schema: { type: "object", additionalProperties: false, properties, required },
    },
  },
});
const email = { type: "string", format: "email", maxLength: 255 };
const password = { type: "string", description: "At most 72 UTF-8 bytes", minLength: 1 };
const lifecycleErrors = {
  "400": problem("Invalid input, compromised password, or invalid verification"),
  "403": problem("CSRF rejected"),
  "429": problem("Rate limited; Retry-After is supplied"),
  "503": problem("Rate limiter or password safety service unavailable"),
};
export const registrationApiPaths = {
  "/v1/auth/register": {
    post: {
      operationId: "registerAccount",
      security: [csrf],
      description:
        "Creates an unverified identity and queues an encrypted verification email atomically. Duplicate accounts receive the same response. Tenant onboarding is a separate, pending module.",
      requestBody: lifecycleBody(
        {
          name: { type: "string", minLength: 1, maxLength: 150 },
          email,
          password: { ...password, minLength: 15 },
        },
        ["name", "email", "password"],
      ),
      responses: {
        "202": success("Request accepted; account existence is not disclosed"),
        ...lifecycleErrors,
      },
    },
  },
  "/v1/auth/verify-email": {
    post: {
      operationId: "verifyEmail",
      security: [csrf],
      description:
        "Consumes a one-time, 30-minute verification code from email. Also requires the registration password to prevent verifying an account registered by someone else. Does not sign in automatically.",
      requestBody: lifecycleBody(
        { token: { type: "string", pattern: "^[a-f0-9]{64}$" }, password },
        ["token", "password"],
      ),
      responses: { "200": success("Email verified; sign in through login"), ...lifecycleErrors },
    },
  },
  "/v1/auth/resend-verification": {
    post: {
      operationId: "resendVerification",
      security: [csrf],
      description:
        "Queues a replacement code only for eligible unverified accounts. Previous codes become invalid; at least 60 seconds between issuance. Unknown, verified, disabled and cooling-down accounts receive the same response.",
      requestBody: lifecycleBody({ email }, ["email"]),
      responses: {
        "202": success("Request accepted; account existence is not disclosed"),
        ...lifecycleErrors,
      },
    },
  },
};

export const passwordResetApiPaths = {
  "/v1/auth/forgot-password": {
    post: {
      operationId: "requestPasswordReset",
      security: [csrf],
      description:
        "Queues an encrypted 30-minute reset code for eligible password accounts. The same generic response is returned for unknown, disabled, passwordless or cooling-down accounts. Requesting a code does not revoke sessions.",
      requestBody: lifecycleBody({ email }, ["email"]),
      responses: {
        "202": success("Request accepted; account existence is not disclosed"),
        ...lifecycleErrors,
      },
    },
  },
  "/v1/auth/reset-password": {
    post: {
      operationId: "resetPassword",
      security: [csrf],
      description:
        "Consumes a single-use reset code, sets a safe new password, verifies mailbox ownership, revokes all previous sessions and verification codes, and queues a change notification atomically. Does not log in automatically.",
      requestBody: lifecycleBody(
        {
          token: { type: "string", pattern: "^[a-f0-9]{64}$" },
          password: { ...password, minLength: 15 },
        },
        ["token", "password"],
      ),
      responses: { "200": success("Password reset; sign in again"), ...lifecycleErrors },
    },
  },
};
