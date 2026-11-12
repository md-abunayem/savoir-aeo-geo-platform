# Password reset

No frontend URL or new environment variables are required. This module uses the existing AUTH_ENABLED, restricted DATABASE_APP_URL, EMAIL_PAYLOAD_KEY, signing secrets and separately configured Brevo email worker. The API queues emails; 202 does not mean delivery. Real emails require deliberate delivery enablement and the email worker. Automated tests do not contact Brevo or Pwned Passwords.

## API / Postman

Use one backend hostname throughout (normally http://127.0.0.1:8000), retaining cookies in Postman.

1. GET /v1/auth/csrf and copy data.csrfToken to X-CSRF-Token for each POST; retain its matching cookie.
2. POST /v1/auth/forgot-password with JSON {"email":"your-address@example.com"}. Returns 202 with the same message for unknown, disabled, passwordless and cooling-down accounts. An eligible account receives an emailed 64-character code when delivery is enabled. Requesting a reset does not change the password or revoke sessions.
3. POST /v1/auth/reset-password with JSON {"token":"code-from-email","password":"your-new-unique-password"}. Returns 200 after success. Passwords use the same policy as signup: at least 15 Unicode characters, at most 72 UTF-8 bytes, and a successful breached-password check.
4. Sign in through POST /v1/auth/login with the new password. Reset does not automatically log in.

Codes expire after 30 minutes and can be used once. A replacement invalidates the previous code. Issuance has a 60-second database cooldown, a three-per-hour email limit and per-IP limits. Reset submission has per-IP and per-token limits. Limiter or password-check outages fail closed. Malformed inputs return 400; invalid/expired/consumed codes return INVALID_RESET_TOKEN; throttling returns 429 with Retry-After.

## Security and account recovery

Reset tokens are separate from email-verification tokens and stored only as SHA-256 hashes. Email payloads are encrypted. Runtime credentials cannot directly read or mutate the token table. Security functions pin search paths and revoke PUBLIC execution.

Issuance and email enqueue commit together. Completion atomically changes the bcrypt password, consumes the reset code, deletes old verification codes, revokes all sessions, records an audit event and queues a password-change notification. Notification enqueue failures roll everything back, allowing a safe retry. Previously queued obsolete code emails may still arrive; only the latest unexpired code works.

A valid reset also establishes mailbox ownership for an unverified password account, allowing recovery when someone else registered the email with an unknown password. Disabled and passwordless accounts are ineligible. Tenant/consent onboarding remains a separate module.

Reset, login session creation and refresh serialize on the user record. Session creation rechecks the password hash that bcrypt verified, preventing a stale in-flight login from creating a session after reset. Refresh cannot leave a surviving session after reset. Existing access and refresh tokens are unusable after completion. The response clears session cookies and does not return passwords or tokens. All reset routes require CSRF and send Cache-Control: no-store.

## Migration and deployment

Migration 0006 adds the reset-token table, security functions and session-race protection. Apply npm run db:migrate and restart the backend with the matching new code. The old three-argument session creation function is no longer executable by the runtime role; deploy migration and new API code together.

No secrets are changed by this module. Retention scheduling for expired tokens, abandoned accounts and operational email handling remains future lifecycle work.
