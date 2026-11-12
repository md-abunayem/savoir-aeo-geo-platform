# Requirement traceability

| Requirement                     | Current implementation                                         | Verification                                         | Status                                                         |
| ------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| IF-API-001                      | Versioned foundation/session routes; OpenAPI 3.1               | HTTP tests                                           | Foundation only                                                |
| IF-API-005                      | RFC 9457 error boundary with stable codes                      | Malformed JSON, size, 404 and CORS tests             | Partial: rate limits pending                                   |
| NFR-OBS-001                     | Structured HTTP logs and generated request IDs; no bodies/URLs | HTTP boundary tests                                  | Partial: traces and tenant context pending                     |
| NFR-SEC-005                     | Helmet, explicit CORS, body limits                             | HTTP tests                                           | Partial: SSRF and prompt-injection controls pending            |
| NFR-REL-001                     | Foundation queue retry configuration and duplicate job test    | Real Redis/worker test                               | Partial: durable product job dispatch pending                  |
| ARCH-02                         | Private test bucket and anonymous-access rejection             | Real S3 round trip                                   | Partial: tenant policies pending                               |
| NFR-QUAL-001                    | Vitest, HTTP tests, real infrastructure tests, CI definition   | npm run check; npm run test:integration              | Partial: core feature coverage pending                         |
| ARCH-01, DR-001, NFR-SEC-004    | Forced RLS, restricted runtime login, Owner transaction helper | Five real database-isolation tests                   | Database/session prerequisite implemented; tenant CRUD pending |
| M1â€“M19 remaining requirements | See implementation-status.md                                   | Requirement-specific tests added with implementation | Pending                                                        |

Infrastructure checks are prerequisites, not completion of product requirements.

## Added milestone 1 coverage

- ONB-FR-001 / NFR-SEC-001: Google OAuth 2.0 with PKCE (S256), state parameter verification (Redis-backed 600s TTL), and identity linking to verified user accounts; email/password registration, one-time email verification, resend, bcrypt password storage, and breached-password checks are implemented and tested.
- ONB-FR-002: Automated initial project setup workflow with 4-step progressive data capture (Brand Profile, Competitors & Prompts, Engine Selection, and Review/Activation).
- ONB-FR-003 / NFR-SEC-005: Domain input normalization and SSRF protection rejecting RFC 1918 private ranges, loopback (`127.0.0.1`, `::1`), link-local metadata (`169.254.169.254`), IPv6 unique local/link-local addresses, IPv4-mapped IPv6 literals, and unresolvable domains.
- ONB-FR-004: Domain crawl and brand profile extraction (Firecrawl crawler integration with LLM brand inference fallback) extracting brand name, aliases, description, category, and products.
- ONB-FR-005: Brand profile review and editing interface supporting alias and product management.
- ONB-FR-006: Competitor recommendation engine proposing 5–10 competitors with rationale, market overlap, and alias seeds.
- ONB-FR-007: Market targeting configuration defaulting to primary market (`US` / `en`) with multi-market expansion support.
- ONB-FR-008: Generation of 25 seed prompts categorized across 4 buyer intents (informational, comparison, transactional, navigational) and funnel stages (awareness, consideration, decision).
- ONB-FR-009: Prompt review and management supporting custom additions, intent tagging, and persona assignment.
- ONB-FR-010: Resumable draft persistence (`GET /v1/onboarding/draft`, `PUT /v1/onboarding/draft`, `DELETE /v1/onboarding/draft`) allowing users to resume multi-step onboarding across sessions.
- ONB-FR-011: Engine selection and monthly credit consumption estimator ($P \times E \times 30$ days) validating projections against the 2,000 credit starter plan quota.
- ONB-FR-012: Atomic project activation (`POST /v1/onboarding/activate` via `savoir_activate_onboarding` PL/pgSQL function) provisioning tenant workspace, owner membership, project, competitors, prompts, default daily schedule, 2,000 credits, audit event, and immediate monitoring run dispatched within 5 minutes.
- ONB-FR-013: Project activation security event logging and welcome email outbox queuing.
- ONB-FR-014: First dashboard landing with active monitoring state and project creation CTA.
- NFR-SEC-002: signed access tokens, hashed rotating refresh sessions, family replay revocation, cookie controls, CSRF and session revocation are tested.
- NFR-SEC-004: restricted runtime startup, real PostgreSQL RLS and Owner transaction context are tested.
- IF-SW-009: Brevo adapter and encrypted outbox implemented with mocked-provider contract tests and real database recovery tests; registration/verification producers have real database tests; password-reset and change-notification producers are implemented; live delivery remains unverified.
- ADM-FR-010: security events for registration, verification requests/completion, OAuth linkage, session creation, rotation, replay, logout, and onboarding activation are recorded.

Password-reset coverage: single-use/expired/replaced codes, atomic outbox rollback, password policy, disabled and unverified account behavior, restricted database access, CSRF/rate limits, session revocation and reset/login/refresh races are covered by integration tests.

## Multi-Engine Provider Adapters (M17) & Monitoring Expansion (M2)

- DCE-FR-001 / IF-SW-001 / IF-SW-003: Multi-engine support across 4 AI surfaces:
  1. Google Gemini via official generateContent API with Google Search grounding.
  2. OpenAI ChatGPT via official API with web-search preview tool enabled for real-time citations.
  3. Google AI Overviews via licensed SERP vendor capturing AI Overviews and organic search context.
  4. Google AI Mode via licensed SERP vendor capturing conversational AI Mode synthesis.
- DCE-FR-002: Comprehensive capture of output text, model versions, token usage, latency (ms), search queries, citations/sources, and raw provider payloads.
- DCE-FR-003 / ARCH-02: Immutable S3 storage of raw responses keyed by tenant, project, run, and lease ID with SHA-256 integrity hashes (`evidenceHash`).
- DCE-FR-004: Strict idempotency key enforcement (`batch_key` + unique `item_key` combining prompt, engine, geo, language, and sample index).
- DCE-FR-005 / MON-FR-011: Pre-execution atomic credit reservations with automated release on failures or uncertain outcomes.
- DCE-FR-006: Multi-sample support ($n \in [1..5]$) per prompt-engine-market (default 1 for daily runs, 3 for deep runs), bound by batch size $\le 500$.
- DCE-FR-007: Canary prompt verification (`canaryTest`) allowing zero-credit health verification of engine connectivity, search grounding, and parser schemas prior to batch execution; circuit breakers on HTTP 429/5xx with exponential backoff and engine-specific failure tracking.
- DCE-FR-008 to 013: Disclosed locale simulation (geo/language hints), engine degradation tracking (`engine.degraded`), model version change detection (`engine.model_changed`), and audit logging.
- MON-FR-001 to 014: Full monitoring lifecycle across all 4 engines with interval schedules, rate-limited manual runs, prompt-level schedule status, operational health reporting, and immutable evidence inspection.

## Next.js integration slice

- IF-API / tenant isolation: GET /v1/projects discovers only the verified authenticated Owner's projects with cursor pagination; migration 0009 and tests/integration/projects.test.ts cover ownership, pagination, input validation and HTTP access.
- MON-FR-002/003/005/006/008/009/012: frontend connects existing schedule, locale/sample, manual-run, control and health APIs. Retrying an uncertain manual submission reuses persisted request metadata; no JWT tokens are stored there.
- M1/identity: existing JWT cookie sessions are consumed by the sign-in screen, session refresh and logout. OAuth and account/onboarding screens remain deferred.
- M3/M13: dashboard currently displays operational monitoring metrics only. It does not claim visibility analytics acceptance.

## Competitor Intelligence (M7)

- CMP-FR-001 to CMP-FR-009: Competitor CRUD (max 25 per project), domain validation, alias tracking, head-to-head comparison matrix (wins, losses, ties), competitor leaderboard, and SOV comparisons.
- CMP-FR-010 to CMP-FR-016: Competitor auto-discovery from engine responses ($\ge 10\%$ topic threshold), classification, competitive gap score $w_p \cdot \max(0, V_c(p) - V_{\text{brand}}(p))$, and CSV exports.

## Free AI Search Grader (M19)

- HG-01 to HG-24 / HG-FR-001 to HG-FR-006: Public unauthenticated grader with Turnstile anti-abuse verification, spend circuit breaker, lightweight prompt generator, competitor auto-discovery, dual-engine sampling, technical preview, shareable 30-day reports, and 1-click project conversion.

## Technical AEO Auditing (M8)

- TEC-FR-001 to TEC-FR-016: Firecrawl polite crawler (max 2 req/s, 500 pages), robots.txt AI bot access matrix (GPTBot, ClaudeBot, PerplexityBot, etc.), indexability & rendering checks, JSON-LD schema validator, heading structure, and weighted Technical AEO Score (0–100).

## Agent Experience Optimization (M16)

- AXO-FR-001 to AXO-FR-010: /llms.txt and /llms-full.txt discovery, fetcher, markdown linter, link resolution, 100-point validation scorer, robots.txt AI policy builder with 4 presets, and JSON-LD schema draft generator.

## Content Intelligence (M9)

- CNT-FR-001: Content inventory built from crawl snapshots and mapped to semantic prompt clusters via TF-IDF n-gram vector cosine similarity.
- CNT-FR-002: Automated content gap identification for prompts with low brand visibility ($< 0.40$) lacking owned page match ($< 0.50$), prioritized by visibility deficit and competitor citations.
- CNT-FR-003: Page-level modeled AEO Content Score (0–100) across 7 pillars: answer-first structure, entity clarity, stats, sources, extraction structure, schema, and credibility.
- CNT-FR-004: Concrete page-level comparison against cited competitor pages detailing word count deltas, missing entities, structural differences, and schema gaps.
- CNT-FR-005 / CNT-F1: Content brief generator with target prompts, PAA/FAQ blocks, outline suggestions, entity recommendations, and citation references, exportable to Markdown (.md) and Word (.docx).
- CNT-FR-006: Page staleness flagging (>90 days) targeting active or high-priority prompts.
- CNT-FR-007: Cannibalization detection for multiple owned pages targeting the same prompt cluster ($\ge 0.60$ similarity).
- CNT-FR-008: Suggested FAQ and PAA blocks derived from tracked prompt demand.
- CNT-FR-009: Mandatory Estimated/Modeled guidance labeling and strict prohibition against automated publishing or writing to customer sites.

## Optimization Action Center (M10)

- ACT-FR-001: Automatic creation of action items from M5 (claims), M6 (citation gaps & broken cited URLs), M7 (visibility gaps), M8 (technical issues), M9 (content gaps & stale pages), and M16 (agent-readiness gaps) with source link and evidence.
- ACT-FR-002: Comprehensive action item data model (title, description, category, source module, evidence, priority score, effort estimate, owner, due date, status, comments).
- ACT-FR-003: Priority score calculation: $\text{round}\left(\min\left(100, \; \frac{\text{Impact} \times \text{Confidence}}{\text{EffortWeight}} \times 10\right)\right)$ with factors labeled Modeled.
- ACT-FR-004: Deduplication engine merging findings from the same root finding by `dedupKey` while preserving audit trace evidence.
- ACT-FR-005: Copy-ready fix guidance generator (`FixGenerator`) with JSON-LD, robots.txt, llms.txt, FAQ blocks, and meta tags labeled Estimated and never auto-applied.
- ACT-FR-006: User management for filtering, sorting, bulk status editing, owner assignment, comments, and dismissal with reason.
- ACT-FR-007: RFC 4180 CSV export with formula injection escaping and API endpoints.
- ACT-FR-008: Closed-loop verification engine (`ActionVerifier`) probing live endpoints, schemas, robots.txt, and markdown indexes upon action completion.

## Integrations (M14) & AI Traffic Analytics (M11)

- ITG-FR-001 / ITG-F1: Google Search Console OAuth connection with read-only scopes (`webmasters.readonly`), daily query sync (impressions, clicks, CTR, position), and automated question query prompt opportunity harvesting.
- ITG-FR-002: Google Analytics 4 OAuth connection with read-only scopes (`analytics.readonly`), daily fact ingestion for sessions, landing pages, and key conversion events.
- ITG-FR-005 / ITG-FR-012: Public REST API customer keys (`sk_live_...`) with SHA-256 storage, scoped permissions (`read:traffic`, `read:actions`, etc.), and tier rate limits (60 req/min default, burst 120).
- ITG-FR-006: Outbound event webhooks signed with HMAC-SHA256 (`X-Savoir-Signature: t=...,v1=...`) with test dispatch validation for `run.completed`, `action.verified`, `alert.created`, `audit.completed`, and `traffic.synced`.
- ITG-FR-010 / ITG-FR-011: Encrypted OAuth token storage at rest (AES-256-GCM) with 1-click provider disconnection and optional imported data purge.
- TRF-FR-001 / TRF-FR-002: AI Traffic Analytics calculating AI referral sessions, engaged sessions, and conversion rate benchmarks against traditional search.
- TRF-FR-003: Dedicated AI Channel Group classifying referral traffic from ChatGPT (`chatgpt.com`, app referrers), Gemini (`gemini.google.com`), Perplexity (`perplexity.ai`), Claude (`claude.ai`), Copilot (`copilot.microsoft.com`), and DeepSeek (`deepseek.com`), with mandatory disclosure: _"Observed: Some AI traffic arrives without a referrer header and is under-counted in web analytics (TRF-FR-003)"_.
- TRF-FR-004: GSC query performance with mandatory disclosure: _"Google Search Console does not isolate AI Overview / AI Mode search traffic directly (TRF-FR-004)"_.
- TRF-FR-008: Crawl-to-citation-to-visit correlation view linking Firecrawl AI bot crawls, citation counts, and converted web sessions, labeled **Modeled**.

## Reporting & Alerts (M13)

- RPT-FR-001 / RPT-FR-002: Cross-module executive KPI aggregation synthesizing Visibility (M3), Citations (M6), Technical AEO (M8), Content (M9), AI Traffic (M11), and Action Velocity (M10) into composite AEO Executive Readiness Index (0–100) with standing classifications (`Leading`, `Competitive`, `Moderate`, `At Risk`) and key wins/critical risks generation.
- RPT-FR-003: Recurring scheduled report management supporting weekly and monthly cadences with automatic next-run calculation.
- RPT-FR-004 / RPT-FR-005: On-demand and scheduled print-ready executive brief compiler with HTML/PDF/JSON format support and Brevo email outbox delivery.
- RPT-FR-006: Real-time alert rule evaluator detecting statistically significant visibility drops ($p < 0.05$, $z \ge 1.96$), competitor overtakes, lost citations, and crawl blockages.
- RPT-FR-007: Alert deduplication and 24-hour cooldown quiet period per rule preventing alert fatigue.
- RPT-FR-008: Multi-channel alert dispatch to in-app triage, webhooks, and transactional emails.
- RPT-FR-009: Incident lifecycle tracking across active, acknowledged, resolved, and dismissed states with optional resolution notes.
- RPT-FR-010: Executive brief HTML rendering with responsive charts, KPI summary grids, and print-to-PDF stylesheet optimization.
- RPT-FR-011: Mandatory statutory measurement disclosures distinguishing Observed telemetry metrics from Modeled/Inferred indices.

## Platform Administration & Stripe Billing (M15)

- ADM-FR-001: Credit allocation and metering model distinguishing monitoring credits from crawl credits.
- ADM-FR-002: Strict monitoring run metering enforcing exactly 1 credit per monitoring run deduction via atomic PostgreSQL balance verification (`SELECT ... FOR UPDATE`).
- ADM-FR-003: Crawl credit metering enforcing 1 crawl credit per crawled page audit deduction, preventing unauthorized crawl overdrafts.
- ADM-FR-004: Three-tier subscription model: Starter ($99/mo, 2,000 monitoring credits, 500 crawl pages), Growth ($299/mo, 8,000 monitoring credits, 2,000 crawl pages), Enterprise ($899/mo, 30,000 monitoring credits, 10,000 crawl pages), plus a 1,000 monitoring credit top-up pack ($50).
- ADM-FR-005: Stripe Checkout session provisioning (`/v1/billing/tenants/:tenantId/checkout`) for plan upgrades, downgrades, and credit top-up purchases.
- ADM-FR-006: Stripe webhook event ingestion (`/v1/billing/webhook`) with timing-safe HMAC-SHA256 signature verification (`crypto.timingSafeEqual`) handling `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.
- ADM-FR-007: Stripe Customer Portal integration (`/v1/billing/tenants/:tenantId/portal`) enabling self-service payment method updates, invoice history inspection, and subscription changes.
- ADM-FR-008: Internal Operator Console directory (`/v1/operator/tenants`) supporting cross-tenant search, filtering by plan tier and status, and deep tenant profiles.
- ADM-FR-009: Tenant lifecycle management with administrative status controls (`active`, `paused`, `archived`) and reason tracking (`/v1/operator/tenants/:tenantId/status`).
- ADM-FR-010: Administrative manual credit adjustment endpoint (`/v1/operator/tenants/:tenantId/credits`) supporting discretionary monitoring and crawl credit grants with operator reason recording.
- ADM-FR-011: Platform queue health and telemetry inspection (`/v1/operator/queues`) monitoring active, waiting, delayed, failed, and paused job counts across monitoring, crawler, and notification queues.
- ADM-FR-012: Immutable operator audit logging (`operator_audit_logs`) tracking administrative actions with actor identity, action type, target entity, and change payloads.
- ADM-FR-013: Operator authentication and authorization boundary enforced via `createOperatorMiddleware` checking `X-Operator-Key` against `OPERATOR_SECRET_KEY`.
- ADM-FR-014: Immutable credit ledger (`credit_ledger_entries`) recording every credit issuance, renewal, deduction, top-up, and manual adjustment with running `balance_after`.
