# Live local monitoring

Run migrations and `npm run storage:init`, then start the API with `npm run dev`
and the separate collector with `npm run monitoring:dev`. The generic worker is
not the collector. Frontend: `npm run dev` from `client`.

Monitoring requires `MONITORING_ENABLED=true`, authentication, the restricted
runtime database role, a provider key with generation quota, and an available
model. Placeholder credentials are ignored. Listing models does not prove that
generation quota is available. `node --import tsx src/scripts/provider-smoke.ts`
makes one actual, potentially billable Gemini request and prints sanitized
diagnostics. Do not run it as a recurring health probe.

Migration 0025 gives each onboarding engine/market a complete schedule and scopes
answer extraction to one database transaction. Missing-provider schedules are
paused. The collector retries unfinished answer extraction without repeating the
AI request. Workspace data refreshes every 15 seconds while the tab is visible.

Local setup for the requested Savoir account is idempotent:
`node --import tsx src/scripts/setup-savoir-live.ts`. It requires the existing
verified owner account, creates three prompts and local platform credits, and
leaves the schedule paused until the provider is verified. Platform credits do
not pay provider bills. Resume the schedule in Monitoring only after a manual
one-sample run succeeds and its parsed answer and citations are visible.

The grader no longer replaces provider failures with synthetic answers. GSC/GA4
sample syncs are disabled in the application; live Google data ingestion remains
unimplemented. Google login requires `GOOGLE_AUTH_ENABLED=true` and real client
credentials. Mock OAuth callbacks are available only to explicitly configured
tests.

## Self-service projects

Open `/projects` to list projects or `/projects/new` to start the six-step setup.
Drafts are saved to the signed-in account when moving forward or choosing Save
draft. Save without running creates the project without provider calls. Initial
analysis and recurring monitoring use a separate, idempotent launch operation.
Website crawls run once; daily or weekly schedules apply to AI monitoring.

Migration `0027_self_service_projects` adds project creation/launch request
tracking, the paused lifecycle state, and crawl request keys. Apply migrations
before using these routes. Project settings can edit prompts, competitors and
markets, pause monitoring, or archive a project. Launch a replacement schedule
after changing its prompts or markets. Restoring a project does not automatically
resume a paused schedule.

Connection status reports configured credentials, not verified provider quota.
Real provider errors appear on the project's progress page. Provider keys remain
in server configuration. Technical Audit, Monitoring and Answer Explorer follow
the persistent selected project and support `?project=<project-id>` links.

Regression checks: `npm run test:integration -- tests/integration/project-management.test.ts`
from `server`, and `npm run test:e2e -- tests/browser/project-portal.spec.ts` from
`client` with the development website running on port 3000. Browser tests mock
provider/API responses and do not make paid provider requests.
