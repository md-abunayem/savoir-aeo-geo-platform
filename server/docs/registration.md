# Backend registration and verification

This identity slice needs no frontend or frontend URL. Tenant onboarding, consent and Google login remain separate pending modules. Password reset is implemented.

## Configuration

AUTH_ENABLED=true requires DATABASE_APP_URL, AUTH_JWT_SECRET, AUTH_CSRF_SECRET and EMAIL_PAYLOAD_KEY (an independent 64-character hexadecimal key). Encryption is required even with MAIL_ENABLED=false because the API queues encrypted messages. Keep the existing key while queued messages exist.

The API only queues email. Delivery needs configured Brevo credentials and the separately started email worker with MAIL_ENABLED=true. A 202 response is not delivery confirmation. With delivery disabled, no verification email reaches an inbox. Never expose codes through a debug endpoint or logs.

Password safety uses the free Pwned Passwords range API, with no API key: https://haveibeenpwned.com/API/v3#PwnedPasswords. Only five characters of a SHA-1 hash leave the backend, with response padding requested. Stored passwords use bcrypt cost 12. Timeout, provider errors and malformed responses fail closed with PASSWORD_CHECK_UNAVAILABLE (503). Automated tests inject a fake service.

## Postman steps

Use the backend address, normally http://127.0.0.1:8000. Retain cookies in Postman and use the same hostname throughout.

1. GET /v1/auth/csrf. Copy data.csrfToken to the X-CSRF-Token header for every following POST; keep the matching cookie.
2. POST /v1/auth/register with JSON containing name, email and password. Passwords require at least 15 Unicode characters and at most 72 UTF-8 bytes. The response is 202 for both new and existing accounts.
3. When delivery is deliberately enabled, copy the 64-character code from the email. POST /v1/auth/verify-email with JSON containing token (the emailed code) and password (the registration password). A valid request returns 200; it does not create a session.
4. POST /v1/auth/login with email and password to receive session cookies.
5. GET /v1/auth/me to check the session.

POST /v1/auth/resend-verification with JSON containing email requests another code. Responses are generic for unknown, verified, disabled and cooling-down accounts. Codes last 30 minutes and work once. Only the newest code works. Issuance has a 60-second database cooldown and a shared per-email limit of three registration/resend requests per hour. Previously queued emails may still arrive; use the newest code.

Verification requires the registration password so a recipient cannot accidentally activate credentials chosen by someone else. Users who did not register or do not know that password should not verify. Use the [password-reset flow](password-reset.md) to recover mailbox ownership and choose a new password.

## Security and scope

Account creation, hashed verification code, audit events and encrypted email enqueue commit together. Enqueue failures roll back the account. Duplicate registration never replaces existing credentials. Concurrent registration serializes by normalized email; verification accepts at most one concurrent consumption. Disabled accounts and expired or consumed codes are rejected. The token table has forced RLS and no direct runtime access; scoped functions revoke PUBLIC execution and pin search paths.

All three POST routes require signed CSRF, enforce Redis rate limits, fail closed on limiter outages and return no-store responses. Request logging excludes bodies, addresses and codes. The OpenAPI contract includes all three endpoints when the registration service is enabled.

Migration 0005 adds the token table and security functions. Tests use disposable databases, simulated password checks and encrypted outbox inspection. No real emails are sent. Expired-token and abandoned-account retention jobs remain future lifecycle work. Signup is not complete SRS onboarding until tenant creation and consent are implemented.
