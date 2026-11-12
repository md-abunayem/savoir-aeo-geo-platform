# Authentication session boundary

The implemented endpoints are enabled only when AUTH_ENABLED=true and DATABASE_APP_URL, AUTH_JWT_SECRET and AUTH_CSRF_SECRET pass validation. Use independent cryptographically random signing secrets of at least 48 characters. Production cookies are Secure; access and refresh cookies are HttpOnly and SameSite=Strict.

## Implemented routes

- GET /v1/auth/csrf issues a signed double-submit token and cookie.
- POST /v1/auth/login accepts email/password for already verified, enabled accounts.
- POST /v1/auth/refresh rotates the refresh token and access cookie.
- POST /v1/auth/logout revokes the session family and clears cookies.
- GET /v1/auth/me validates both the signed JWT and current database session.

Every authentication POST requires the matching CSRF cookie and X-CSRF-Token header. Auth responses are no-store. Tokens are never returned in login JSON.

Access JWTs expire after 15 minutes. Refresh families have an absolute seven-day expiry. Rotation immediately invalidates the previous session/access JWT. Reusing any revoked refresh token revokes the whole family. Clients must serialize refresh calls; concurrent reuse is treated as replay, not silently tolerated.

Only SHA-256 refresh-token hashes are stored. Session creation, rotation, replay revocation and logout create security events. Runtime credentials cannot directly read or change session/event tables; narrowly scoped SECURITY DEFINER functions implement the identity boundary. Functions pin the search path, qualify table references, and revoke PUBLIC execution.

Redis throttling fails closed. Login has per-IP and per-account limits. Refresh/logout are separately limited. IP and email values are hashed in Redis keys and omitted from request logs. Reverse-proxy trust remains disabled until the deployment topology is selected.

## Deliberate unfinished flows

Google OAuth, account deletion and general platform auditing are still pending. There is no default account, auto-verification route or development login bypass. Test users exist only in disposable test databases.

Do not mark existing user records verified manually. Use the verification flow.

No production deployment is ready until these flows, release requirements and the external-service decisions are complete.

## Registration and verification

Registration, one-time verification and resend are implemented. EMAIL_PAYLOAD_KEY is required when AUTH_ENABLED=true, even when mail delivery is disabled. See [registration.md](registration.md) for the backend-only API flow and remaining limitations.

Password-reset request and completion routes are implemented; see [password-reset.md](password-reset.md). Successful reset revokes all sessions and requires a fresh login.
