# Monitoring operations: Gemini and OpenRouter

## Current configuration and diagnosis (9 November 2026)

The API entry point is `src/index.ts`; the separate monitoring process is
`src/workers/monitoring.worker.ts`. Compose runs PostgreSQL 16, Redis 7 and object
storage only; API and worker run on the host. Both load `server/.env` relative to
their module location, including compiled builds. Injected environment variables
have precedence. Credentials are captured at startup: restart **both** processes
after rotation; an existing process cannot acquire edits to its environment.

A live, read-only Gemini metadata check returned HTTP 200 for the configured
`gemini-3.1-flash-lite`. Authentication and metadata access succeeded; generation,
Google Search support for that account/model, and quotas were not tested.
OpenRouter reported `ENGINE_NOT_CONFIGURED`: configure its key before using it.
The configured database had no monitoring runs in the last seven days during
this audit. No evidence establishes current generation quota balances or prior
authentication failure causes. Do not infer quota availability from a metadata check.

Confirmed code defects addressed:

- Launch-directory-dependent dotenv loading could select the wrong file.
- Metadata outages could defer queued jobs indefinitely. Three one-minute
  deferrals now precede terminal failure; counts survive worker restarts.
- Preflight used the current default model rather than the immutable run model.
  It now checks credentials only; generation uses the exact saved model.
- Grounding zero-quota errors lost their grounding category; quotaMetric-only
  responses were missed. Both structured fields now participate in classification.
- OpenRouter discarded error bodies, losing daily quota and temporary budget
  distinctions. HTTP 503 identifies unavailable capacity; 402 is terminal except
  for the documented temporary in-flight budget restriction.
- Failures stored only an opaque code. New failures retain safe category/message,
  provider/model, HTTP status when known, attempts, timestamp and final status in
  `result.failure`, alongside existing request/error_code/attempts fields.
- Provider quota failures did not pause future scheduled cycles. They now pause
  only their originating active schedule and retain its configuration and reason.
- The smoke script could print credential metadata inside raw provider errors.
  It now prints only allowlisted result/error information.

## Verification for this change

- Full unit/API suite: 249 tests passed across 28 files.
- Focused monitoring integration suites: 38 tests passed against disposable local
  PostgreSQL databases, including migration 0037, durable retries, lease recovery,
  credit accounting, duplicate prevention and manual/provider quota pause behavior.
- Type checks, ESLint, production build and formatting checks passed.
- Gemini live metadata authentication: HTTP 200. OpenRouter: key missing.
- No live generation, grounding, email delivery or application database migration
  was performed. No provider credentials or infrastructure configuration changed.

The integration fixture intentionally refuses a non-local DATABASE_URL. The local
run used the existing Compose PostgreSQL credentials only for disposable test
fixtures, with `--hookTimeout 120000`; the default 20-second setup allowance timed
out on this machine. The provisioning subprocess also required running outside
the Windows sandbox because tsx could not read the sandbox user's profile.

## Changed files

| Files                                                                                                           | Purpose                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/config/load-env.ts`, `src/index.ts`, `src/workers/monitoring.worker.ts`, `src/scripts/monitoring-check.ts` | Consistent server environment loading and safe worker configuration/failure logs.       |
| `src/services/monitoring/gemini-auth.ts`, `credential-preflight.ts`                                             | Missing/invalid credentials, safe metadata checks independent of saved run models.      |
| `src/services/monitoring/gemini.adapter.ts`, `openrouter.adapter.ts`                                            | Structured quota classification, timeout ambiguity, HTTP status and strict routing.     |
| `src/services/monitoring/provider-errors.ts`, `types.ts`, `processor.ts`, `monitoring.service.ts`               | Actionable categories and persistent run/canary diagnostics.                            |
| `src/scripts/provider-smoke.ts`                                                                                 | Remove raw provider-error output.                                                       |
| `drizzle/0037_monitoring_failure_recovery.sql`, `drizzle/meta/_journal.json`                                    | Atomic schedule quota pauses, crash/preflight diagnostics and bounded metadata retries. |
| `tests/provider-reliability.test.ts`, `tests/monitoring-queue.test.ts`, `tests/integration/monitoring.test.ts`  | Provider, preflight and durable pause/recovery regressions.                             |
| `.env.example`, `docs/monitoring.md`                                                                            | Credential, restart, recovery and audit instructions.                                   |

## Credentials, validation and startup

Create a Gemini Developer API key in https://aistudio.google.com/api-keys and set
`GEMINI_API_KEY`. Both standard and Authorization API keys use `x-goog-api-key`;
this is not an OAuth bearer token or a Vertex AI credential. The REST adapter is
already on the supported Developer API path; no SDK replacement was necessary.
See https://ai.google.dev/gemini-api/docs/api-key.

Create an OpenRouter key at https://openrouter.ai/settings/keys and set
`OPENROUTER_API_KEY`. The configured default is `openai/gpt-6-luna`. Requests
enable OpenRouter native web search, disable provider fallbacks, and cap model-token
prices at $0.10 per million input tokens and $0.50 per million output tokens.
Web-search charges are separate from these token-price caps.

Required execution settings: `MONITORING_ENABLED=true`, the selected provider's
key and model, runtime database/Redis/storage settings, and the existing auth and
email-payload settings. `MONITORING_DAILY_CALL_LIMIT` and
`MONITORING_CALL_SPACING_SECONDS` constrain local traffic; they do not increase
provider quotas. Token limits are `GEMINI_MAX_OUTPUT_TOKENS` and
`OPENROUTER_MAX_OUTPUT_TOKENS`. Never put provider credentials in Compose's
PostgreSQL, Redis or storage services.

From the repository root in PowerShell:

```powershell
cd server
npm.cmd run db:migrate
npm.cmd run build
npm.cmd run monitoring:check -- --engine=gemini
npm.cmd run monitoring:check -- --engine=openrouter
npm.cmd start
```

In a second terminal, from `server`:

```powershell
npm.cmd run monitoring:start
```

For development use `npm.cmd run dev` and `npm.cmd run monitoring:dev` in those
two terminals. To restart, Ctrl+C each existing process, wait for exit, then run
its command again. Do not start a second copy as a substitute for restarting.
Apply migration **0037** before running the updated worker. It preserves the
existing schema, role permissions, durable queue and lease-fenced completions.

## Quota, grounding and recovery

Check Gemini usage and rate limits in AI Studio for the exact project/model and
billing tier: https://ai.google.dev/gemini-api/docs/rate-limits. RPM, TPM and RPD
are different constraints. Google Search grounding has separate allowances and
model/tier eligibility: https://ai.google.dev/gemini-api/docs/google-search.
Inspect OpenRouter usage at https://openrouter.ai/activity and key limits in its
settings. Provider pricing, capacity, and search fees are external and can change.

Generic 429 and transient 500/502/503/504 responses receive at most three retries
after the initial attempt, on the exact saved provider/model. Delays use
exponential backoff plus jitter, honor Retry-After/Google RetryInfo, and are capped
at seven days by the existing queue contract. Explicit daily/zero/grounding quota,
authentication, permission and model errors are terminal. Local request timeouts
and ambiguous network failures are `uncertain`, with no automatic replay of a
possibly billable request. Database leases and one-attempt BullMQ request jobs
prevent two retry layers from multiplying generation calls.

`paused` means an explicit manual pause. `quota_paused` means an automatic pause:
`config.pausedBy=provider_quota` and `config.pauseReason` identify new provider
quota pauses; existing credit-quota pauses mean exhausted Savoir credits. No
background quota probing or midnight-based auto-resume is implemented. UTC daily
local call budgets are not provider reset times. Restore credits or verify provider
usage/grounding availability, then explicitly PATCH
`/v1/tenants/{tenantId}/projects/{projectId}/monitoring/schedules/{id}` with
`{"status":"active"}` using the existing login and CSRF headers. Manual pauses
are never automatically overridden. Resuming preserves prompt/model/locale
configuration; it does not replay terminal or uncertain runs. Already reserved
runs are independent of future schedule status.

Grounding stays requested on every Gemini monitoring call. The existing product
policy allows Google to return no sources and records `grounded=false`; this is
not silently disabling the Search tool or substituting another model. Unsupported
tools/model/account combinations fail transparently. Metadata authentication is
not proof of grounding eligibility. Use one explicit canary only when generation
verification is desired; it may consume provider quota or incur provider charges.

Expired processing leases become uncertain and refund Savoir credits without a
second generation call. Database/storage failures remain distinct from provider
failures. Graceful shutdown waits for work up to SHUTDOWN_TIMEOUT_MS; forced exits
use that same lease recovery. Observe `/runs`, `/events` and `/health` after a
restart. Failed runs expose `result.failure`; historical runs are not rewritten.

The sections below retain historical product/API details and verification records;
the current behavior and verification above supersede conflicting old descriptions.

---

## Historical M2 implementation notes

This implements the Gemini monitoring path and the minimal M17/M15 execution and credit prerequisites. OpenAI, Google AI Overviews and AI Mode remain explicitly unavailable. M1 onboarding is still deferred. Monitoring is not a claim that all SRS M2/M17 acceptance requirements have been met.

## Configuration and processes

GEMINI_API_KEY stays server-side: the monitoring worker uses it for collection, and the API uses it for explicitly requested connection tests. The API exposes authenticated management routes whenever authentication is enabled. Manual dispatch and connection tests require MONITORING_ENABLED=true. Scheduled execution requires that flag and the separate worker. Defaults keep execution disabled; adding a key alone does not make provider calls.

- MONITORING_ENABLED=false by default. Set true only when ready for actual calls.
- GEMINI_MODEL defaults to gemini-3.8-flash and is recorded in schedule/run configuration. Confirm model availability for your account before live use; it is configurable.
- MONITORING_DAILY_CALL_LIMIT=100 counts worker attempts globally, including retries. Explicit API connection tests are separate and use the authenticated monitoring write rate limit. This is a call-count cap, not a dollar budget.
- MONITORING_CALL_SPACING_SECONDS=10 spaces requests globally across workers.
- GEMINI_MAX_OUTPUT_TOKENS=2048 bounds generated output.
- Optional GEMINI_INPUT_USD_PER_MILLION and GEMINI_OUTPUT_USD_PER_MILLION produce token-only estimates. With no rates configured, monetary cost is null, never fabricated. Estimates exclude grounding fees and cannot replace invoice reconciliation.

Keep the existing database, Redis, S3, authentication secrets and EMAIL_PAYLOAD_KEY settings. MAIL_ENABLED controls email delivery independently. Monitoring alerts queue encrypted email; the email worker must be deliberately enabled to deliver it.

Apply migrations with npm run db:migrate. Restart npm run dev after changing configuration. Start npm run monitoring:dev separately for live collection (or monitoring:start after build). Starting the normal API does not start collection. No live Gemini call is part of automated tests.

POST `/v1/tenants/{tenantId}/projects/{projectId}/monitoring/canary` requires an `Idempotency-Key` header and an engine in the request body. Reuse the key after a lost response: migration 0030 stores a reservation before contacting the provider and returns the saved outcome on replay. An interrupted test stays uncertain instead of issuing another paid request. A new key represents a new, explicitly confirmed test. These tests use no Savoir credits, but provider quota and charges may apply. They are stored separately from monitoring answers.

The Gemini adapter uses the official generateContent API and Google Search tool. It preserves citation metadata and Search entry-point information; these are untrusted content and must not be rendered as arbitrary HTML. API output is not claimed to reproduce the consumer Gemini app. Geo/language are prompt-context simulation, not verified physical location. Grounding is requested; when Google supplies no sources, grounded=false is recorded rather than inventing citations.

References: https://ai.google.dev/gemini-api/docs/google-search and https://ai.google.dev/gemini-api/docs/models

## Existing project or local development setup

Routes require an authenticated verified Owner and an existing active project. The usual tenant onboarding flow remains unimplemented.

A local-only administrator command can create a development workspace/project for an EXISTING verified account and allocate explicit test credits:

```powershell
node --import tsx src/scripts/monitoring-provision.ts --email YOUR_VERIFIED_EMAIL --domain example.com --credits 100 --request-id YOUR_NEW_UUID
```

Generate a request UUID with node -e "console.log(require('crypto').randomUUID())". Repeating the same request ID and arguments returns the existing setup without issuing more credits. Different arguments with that ID are rejected. The command only accepts localhost databases outside production and never creates or verifies a user. It prints tenantId/projectId. Optional --minimum-interval 60 permits hourly schedules for that development account; default entitlement is daily. These are internal test credits, not a subscription or a promise of free Gemini API usage. No development account or workspace is created automatically during implementation.

Production plan allocation, paid credit grants, Stripe and operator administration remain separate modules. Runtime/API credentials cannot mint credits.

## API flow

Base path: /v1/tenants/{tenantId}/projects/{projectId}/monitoring. Use the existing login cookies. Fetch /v1/auth/csrf and send its matching cookie and X-CSRF-Token header on all POST/PATCH/DELETE requests. All responses are no-store. Reads and writes are rate-limited per user/project; unavailable limiting fails closed.

1. POST /prompts with {"body":"Which brands are recommended for ...?","persona":"buyer"}. Keep the returned prompt ID. PATCH /prompts/{id} changes text/persona and increments the version; {"active":false} pauses future selection. Existing run snapshots remain unchanged.
2. POST /runs with Idempotency-Key: a-new-unique-key and {"engine":"gemini","promptIds":["PROMPT_UUID"],"geos":["US"],"languages":["en"],"samples":1}. Manual sampling defaults to 3, range 1-5. Use samples=1 immediately after adding a prompt for backfill, then create its schedule. A batch contains at most 500 combinations. Duplicate identical submissions return the same run IDs; changed inputs with the same key return 409.
3. POST /schedules with {"promptIds":["PROMPT_UUID"],"cadence":"daily"}. Scheduling defaults to one sample. Other options: weekly, or custom with intervalMinutes (60-43200), subject to the tenant minimum interval. These are fixed intervals measured in UTC, not calendar/time-zone cron expressions. First execution is due immediately; missed intervals after downtime are skipped rather than replayed as a burst.
4. PATCH /schedules/{id} with {"status":"paused"} or {"status":"active"}. DELETE /schedules/{id} removes future scheduling while retaining history. POST /schedules/status applies active/paused/deleted to all Gemini schedules in the project. Pausing/deleting schedules does not cancel already reserved runs.
5. GET /runs and /runs/{id} inspect metadata, status, normalized answers, citations and usage. GET /runs/{id}/evidence reads the authorized private evidence object. GET /health provides backlog, last successful run, seven-day success rate, credits used and available/reserved balance. A null success rate means no completed observations. GET /events includes quota notifications and model-change flags. GET /engines shows unavailable engines explicitly.

Lists support limit (1-100, default 25) and before (last returned UUID) cursor pagination.

## Prompt-level schedule controls (MON-FR-008)

Apply migration 0008 before starting this API/worker version. POST /prompts/{id}/schedules/status accepts {"status":"paused"}, {"status":"active"}, or {"status":"deleted"}. This changes that prompt's selection across existing non-deleted schedules, preserving other prompts in shared schedules. Pauses are stored in config.pausedPromptIds; resuming removes that pause and takes effect on the next due cycle. Resume does not override a paused/quota-paused schedule or an inactive prompt. Deleting removes the prompt from schedule configuration and soft-deletes schedules left empty. Resume does not restore removed selections; create a new schedule explicitly. Existing reserved runs, historical snapshots and credits are unchanged. Repeated requests are safe; a prompt with no matching schedules returns an empty schedules array. Unknown or inaccessible prompts return 404.

## Dispatch, credits and failures

PostgreSQL is the durable run queue. BullMQ supplies a recurring wake-up; database rows survive missed Redis wake-ups. The scheduler locks due schedules and reserves credits in the same transaction as run insertion. Dispatch rechecks active projects and prompt ownership. There is one credit per prompt/engine/geo/language/sample combination.

Available credits move to reserved at enqueue. Success and observed safety refusals commit one credit; permanent technical failures and uncertain outcomes release it. All changes and events commit atomically. Concurrent duplicate batches cannot reserve twice; completion is fenced by a lease and cannot charge twice. Run requests preserve prompt text/version, engine/model, locale/persona, simulation method, sample index and collection policy version.

Transient HTTP 429/5xx, malformed responses and empty/incomplete answers retry at most three times after the initial attempt, with exponential backoff and any provider-supplied Retry-After. A generic 429 without a retry time uses bounded local backoff; explicit zero, daily, or grounding quota failures and authentication errors remain terminal. Retries stay on the selected provider and never switch to a paid model or web search. Four failed attempts release the credit. Network ambiguity, storage-write ambiguity and expired worker leases are marked uncertain without an automatic repeat of a possibly paid call. Gemini does not provide an end-to-end exactly-once guarantee; provider costs may exist for unsuccessful or ambiguous attempts even though platform credits are refunded.

A provider failure period over one hour opens a 15-minute cooldown. Model-version changes are flagged. Quota exhaustion records an event, pauses the affected schedule and queues an Owner alert. After credits are restored, explicitly resume quota-paused schedules. The notification outbox commits atomically and deduplicates by event and recipient.

Evidence writes use an immutable object key and conditional creation, with SHA-256 integrity metadata. Baseline email-address redaction applies to stored response content. This is not a complete private-person PII detector; comprehensive classification/redaction and data-retention policy validation remain M17/M18 work. No customer user ID/email is deliberately included in Gemini requests; administrators should not put private personal data into monitoring prompts.

## Scope remaining

- Other three SRS engines and licensed vendor selection.
- Live provider acceptance, account-specific model/grounding availability and rate quotas.
- Exact cost/grounding-fee accounting, monetary budgets, invoicing and production plan entitlements.
- Cross-brand visibility-shift anomaly detection, canary calibration and analytics aggregation/confidence intervals (M3/M17); current health aggregation is operational only.
- Multi-vendor fallback, comprehensive PII handling, retention/reconciliation tools and production operator workflows.
- SRS 100-prompt/four-engine completion targets and broader load/resilience acceptance.

M1 remains deferred; the local provisioning command is not its replacement. Tests use fake Gemini and evidence adapters with real disposable databases, plus existing Redis/S3 infrastructure tests. Implementation verification uses disposable test accounts and test-credit grants only. No real Gemini requests, developer-account provisioning, developer credit grants or real email sends were performed.

## Verified checkpoint

28 unit/API tests and 57 integration tests passed, including a focused provisioning rerun after its fix. Type checks, lint, formatting and production build passed. Migration 0007 is applied locally. The live worker remains disabled and real Gemini acceptance has not been performed.

## Prompt schedule follow-up verification - 6 November 2026

Implemented MON-FR-008 prompt-level pause/resume/removal within shared Gemini schedules. Migration 0008 is applied locally. Restricted runtime access to the updated command and scheduler functions was verified. All 28 unit/API tests and all 61 integration tests passed; application/test type checks, ESLint, formatting and production build passed. No live Gemini calls, real email sends, account provisioning or credit grants were performed. Live collection remains disabled. M1 and Google login remain deferred; the other M2 engines and broader acceptance gaps listed above remain pending.
