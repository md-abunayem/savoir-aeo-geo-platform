# Brevo transactional email

Brevo is the selected transactional provider. Delivery is implemented behind a separately enabled worker; it has not been live-tested and no real email has been sent.

## Configuration

Keep MAIL_ENABLED=false until a verified Brevo sender and API key are configured. Set BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, EMAIL_PAYLOAD_KEY and DATABASE_APP_URL in the local environment or production secret manager. EMAIL_PAYLOAD_KEY must be an independent random 32-byte key encoded as 64 hexadecimal characters. Do not paste secrets into chat or commit them.

The sender must be verified in Brevo. Production region/data-processing and provider-register review still apply to the external provider; a US database does not by itself establish the email provider's residency.

Use npm run email:dev locally or npm run email:start after a build. This worker can send actual queued messages when enabled. It is not started by npm run dev or the ordinary foundation-worker command.

## Implemented behavior

The adapter calls the official transactional email endpoint using api-key authentication and a stable UUID idempotency key. Message text is escaped before HTML generation. HTTP 201 with a message ID means accepted by Brevo, not confirmed inbox delivery. Bounce/delivery webhooks are not implemented yet.

The outbox stores AES-256-GCM encrypted payloads. Application code cannot read the table directly; scoped SQL functions enqueue, claim and complete work. Producers must use a stable ID per logical email and enqueue inside the same database transaction as their business change. Registration and verification producers are implemented; password-reset request and change-notification producers are also implemented.

Claims use leases and SKIP LOCKED. The worker handles a maximum of ten messages per scheduled job, checks every five seconds, and respects provider retry delays. Retries reuse the original UUID. Payloads are cleared after acceptance or terminal failure.

Brevo documents a 30-minute idempotency window. Our automatic recovery stops after 20 minutes from the first attempt; older ambiguous work becomes uncertain for operator review. Five attempts are the maximum. Never blindly create a new message ID to retry an uncertain send.

An expired outbox payload is cleared when the enabled worker next sweeps the outbox. A separate retention/maintenance scheduler is still needed for cleanup when delivery is disabled. Keep the encryption key until pending/uncertain messages are resolved; rotation/versioned key support is pending production hardening.

## Tests and remaining work

Contract tests inject a fake HTTP transport; integration tests use a fake provider and a real disposable database. They check escaping, throttling, errors, encryption tampering, enqueue deduplication, concurrent claims, lease recovery and expiry. They do not contact Brevo.

Next: consent records, broader account lifecycle and tenant creation. Registration, verification and breached-password checks are implemented. Also pending: operator replay/review UI, Brevo webhook authenticity/delivery-state handling, sender/DNS setup, and a user-approved live delivery test.

References: [Transactional API](https://developers.brevo.com/reference/send-transac-email) and [idempotency behavior](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).
