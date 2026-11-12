# Backend implementation status

Updated 6 November 2026. This is a handoff checkpoint, not a claim that the full backend is complete.

## Completed

- Milestone 0: reproducible foundation, configuration, typed Chai-style structure, health/OpenAPI, logging/error handling, Redis/BullMQ/S3 clients, separate worker, checks and CI definition.
- Milestone 1 database prerequisite: forced RLS on current tables, restricted runtime login, Owner-scoped transaction helper, and verified cross-tenant denial.
- Milestone 1 session slice: bcrypt verification for existing verified accounts, HS256 access JWTs (15 minutes), hashed refresh tokens (7-day absolute session lifetime), refresh rotation, family replay revocation, signed CSRF, Redis throttling, logout, current-user lookup, and append-only application access to security events.
- Milestone 1 Onboarding & Google OAuth 2.0 (Step 1.1 / ONB-FR-001 to ONB-FR-014):
  - Google OAuth 2.0 with state/PKCE verification, Redis state caching, and identity linking (`savoir_oauth_login_or_link` and `savoir_oauth_create_session`).
  - Domain normalization and SSRF validation rejecting RFC 1918 private ranges, AWS metadata (`169.254.169.254`), loopbacks, IPv6 equivalents, and unresolvable domains.
  - Multi-step onboarding API (`/v1/onboarding/draft`, `/v1/onboarding/analyze-domain`, `/v1/onboarding/generate-seeds`, `/v1/onboarding/estimate-costs`, `/v1/onboarding/activate`).
  - Brand profile crawling/extraction (Firecrawl integration), competitor seeding (5–10 competitors), and 25 seed prompts generated across 4 buyer intents.
  - Cost projection engine estimating monthly credit burn ($P \times E \times 30$ days) against the 2,000 credit plan allocation.
  - Atomic workspace/project activation PL/pgSQL function (`savoir_activate_onboarding`) with credit seeding, competitor insertion, prompt registration, daily schedule setup, draft cleanup, and immediate initial monitoring run dispatch (<5 min).
  - Resumable 4-step frontend onboarding wizard in `client/app/onboarding` with draft auto-save and Google Sign-In on authentication screens.
  - All migration `0011_onboarding_and_oauth.sql` DDL and RLS policies applied.

- Milestone 17 Provider Adapters & Milestone 2 Monitoring Expansion (Step 1.2 / DCE-FR-001 to DCE-FR-013, MON-FR-001 to MON-FR-014):
  - OpenAI Responses API adapter (`createOpenAIProvider`) with hosted web search, model version tracking, token usage parsing, latency measurement, search-query and citation extraction, refusal handling, and token-based cost projection.
  - Licensed SERP Vendor Adapter (`createSerpProvider`) capturing Google AI Overviews and Google AI Mode responses with source references, factual lack-of-overview detection, and per-call fee calculation.
  - Multi-Engine Provider Dispatcher (`createMultiEngineProvider`) routing between Gemini, OpenAI, Google AI Overviews, and Google AI Mode with canary health testing (`canaryTest`).
  - Database migration `0012_multi_engine_adapters.sql` adding provider state tracking for all four engines, multi-engine run enqueue with distinct item keys, fair claiming across available engines, and engine-specific failure cooldowns and model drift notifications.
  - S3 immutable evidence persistence with SHA-256 content hashes, PII email redaction, and atomic credit reservations and releases.
  - Unit and integration tests covering multi-engine routing, rate limiting (429 Retry-After), canary execution, and database run execution.

- Milestone 5 Answer Processing Pipeline (Step 1.3 / ANS-FR-001 to ANS-FR-011, NFR-QUAL-002):
  - Entity extraction worker parsing mentions, aliases, list ranks, and sentiment (+1, 0, -1 with >=0.6 confidence threshold).
  - Citation extraction, canonicalization, domain classification, and claims mapping.
  - Interactive Answer Explorer UI (`client/components/answer-explorer.tsx`) with side-by-side engine prompt diffing.
  - Migration `0013_answer_processing_pipeline.sql` with RLS policies applied.

- Milestone 3 AI Visibility Analytics Engine (Step 2.1 / VIS-FR-001 to VIS-FR-011):
  - Normative AI Visibility Score (0-100) combining Visibility Rate (V), Share of Voice (SoV), Mention Position Score, Sentiment Score, and Citation Rate (CR) with letter grade bands A-F.
  - 95% Wilson confidence intervals for proportions, cluster bootstrap for small samples, two-proportion z-tests with Benjamini-Hochberg FDR control.
  - Mandatory metric labels: `Observed`, `Modeled`, `Estimated`.
  - Frontend Visibility Analytics Dashboard (`client/components/visibility-dashboard.tsx`) with 7-day rolling smoothing, anomaly alerts, goals, and RFC 4180 CSV export.
  - Migration `0014_visibility_analytics.sql` applied.

- Milestone 6 Citation Intelligence (Step 2.2 / CIT-FR-001 to CIT-FR-011):
  - Citation counts, shares, and brand citation rates with 95% Wilson score confidence intervals and reliability badges (`Low confidence n<5`, `Insufficient data n<3`).
  - Domain citations table with distinct pages count, engines, and trend status (`new`, `lost`, `retained`).
  - Citation Gap Analysis (`Feature CIT-F1`): Automated detection of prompts where competitors are cited but the brand is missing, ranking by opportunity score (`Frequency × AvgPriority × 10`) with actionable recommendations.
  - Broken brand citation scanner detecting HTTP 4xx/5xx and 3xx redirect chains with live validation and status resolution.
  - Domain source classification overrides and allow/deny lists (`source_domains`).
  - RFC 4180 CSV export for domains, pages, gaps, and broken citations.
  - Interactive Citation Intelligence Dashboard (`client/components/citation-intelligence.tsx`) and route `/citations`.
  - Migration `0015_citation_intelligence.sql` with PostgreSQL RLS applied.

- Milestone 7 Competitor Intelligence (Step 2.3 / CMP-FR-001 to CMP-FR-016):
  - Competitor CRUD management (up to 25 competitors per project with domain and alias tracking).
  - Competitor Auto-Discovery (`CMP-FR-010`): Scans answers for unmanaged entities appearing in $\ge 10\%$ of runs per topic and recommends addition.
  - Competitive Gap Score: $\text{Gap}(p,c) = w_p \cdot \max(0, V_c(p) - V_{\text{brand}}(p))$.
  - Head-to-head comparison matrix (wins, losses, ties), competitor leaderboard, and share of voice comparisons.
  - Interactive Competitor Intelligence Dashboard (`client/components/competitor-intelligence.tsx`) and route `/competitors`.
  - Migration `0016_competitor_intelligence.sql` with PostgreSQL RLS applied.

- Milestone 19 Free AI Search Grader (Step 2.4 / HG-01 to HG-24, HG-FR-001 to HG-FR-006):
  - Public landing page with Cloudflare Turnstile token validation, rate-limiting (3 runs/day per IP/fingerprint), and circuit breaker ($\le \$0.50$ per run).
  - Lightweight pipeline generating 12–20 prompts across intents, auto-discovering competitors, sampling ChatGPT and Gemini in isolated queue (`grader`), and checking AI bots in robots.txt and schema.
  - Grade calculation identical to M3, shareable 30-day tokenized links, email-gated report delivery, and 1-click conversion to monitored project importing seed data.
  - Public grader interface (`client/app/grader/page.tsx` and `client/app/grader/[shareToken]/page.tsx`).
  - Migration `0017_grader.sql` applied.

- Milestone 8 Technical AEO Auditing (Step 3.1 / TEC-FR-001 to TEC-FR-016):
  - Firecrawl crawler integration respecting robots.txt and rate limits (max 2 req/s per host, 500-page default cap).
  - AEO Rule Engine inspecting AI bot access matrix (`GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `Google-Extended`, `ClaudeBot`, `PerplexityBot`, `Bingbot`, `CCBot`), canonicals, raw vs JS DOM rendering diffs, schema validation (`Organization`, `Product`, `Article`, `FAQPage`, `HowTo`, `LocalBusiness`), and heading hierarchy.
  - Technical AEO Score (0–100) with weighted categories (Bot access 25%, Indexability 25%, Schema 20%, Structure 15%, Performance/Trust 10%, Agent readability 5%).
  - Issue remediation suggestions with severity and affected URLs.
  - Interactive Technical Audit Dashboard (`client/components/technical-audit.tsx`) and route `/technical`.
  - Migration `0018_technical_aeo_auditing.sql` with PostgreSQL RLS applied.

- Milestone 16 Agent Experience Optimization (Step 3.2 / AXO-FR-001 to AXO-FR-010):
  - `/llms.txt` and `/llms-full.txt` discovery, fetcher, markdown linter, link resolution, and 100-point validation scorer.
  - Robots.txt AI Policy Builder generating presets (`full_block`, `search_only`, `train_and_search`, `custom`) distinguishing training bots from search/answer bots (`AXO-FR-003`).
  - Draft generator for `llms.txt` and JSON-LD schema templates from crawl and prompt inventory.
  - Interactive Agent Experience Dashboard (`client/components/agent-experience.tsx`) and route `/axo`.
  - Migration `0019_agent_experience_optimization.sql` with PostgreSQL RLS applied.

- Milestone 9 Content Intelligence (Step 3.3 / CNT-FR-001 to CNT-FR-009, CNT-F1):
  - Content inventory mapped to prompt clusters using TF-IDF n-gram vector semantic similarity and cosine matching.
  - Content Gap Identification (`CNT-FR-002`) detecting prompts with low brand visibility ($< 0.40$) lacking owned page match ($< 0.50$), prioritized by visibility deficit and competitor citations.
  - Page-level modeled AEO Content Score (0–100) evaluating answer-first structure, entity clarity, stats, sources, extraction structure, schema, and credibility.
  - Competitor page side-by-side comparison (`CNT-FR-004`) detailing word count delta, missing entities, structural differences, and schema gaps.
  - Content brief generator with target questions, PAA/FAQ blocks (`CNT-FR-008`), suggested outlines, entity inclusions, facts, and sources to cite.
  - Estimated/Modeled guidance disclaimer (`CNT-FR-009`) ensuring zero automated publishing to customer sites.
  - Direct export of briefs as Markdown (`.md`) and Microsoft Word (`.docx`).
  - Cannibalization risk detection (`CNT-FR-007`) and page staleness tracking (`CNT-FR-006`).
  - Interactive Content Intelligence Studio (`client/components/content-intelligence.tsx`) and route `/content`.
  - Migration `0020_content_intelligence.sql` with PostgreSQL RLS applied.

- Milestone 10 Optimization Action Center (Step 4.1 / ACT-FR-001 to ACT-FR-008):
  - Automated action harvester converting findings across M5 (inaccurate claims), M6 (citation gaps & broken cited URLs), M7 (visibility gaps), M8 (technical issues), M9 (content gaps & stale pages), and M16 (agent-readiness gaps).
  - Modeled priority score formula: $\text{round}\left(\min\left(100, \; \frac{\text{Impact} \times \text{Confidence}}{\text{EffortWeight}} \times 10\right)\right)$ with factor transparency.
  - Automated finding deduplication by `dedupKey` with evidence merging.
  - Copy-ready fix guidance generator (`FixGenerator`) producing JSON-LD snippets, `robots.txt` allow rules, `llms.txt` drafts, FAQ blocks, and meta tags labeled **Estimated** with strict non-auto-publishing guarantees.
  - Closed-loop verification engine (`ActionVerifier`) probing live endpoints, schemas, robots.txt, and markdown indexes upon action completion.
  - Interactive Action Center UI (`client/components/action-center.tsx`) with Kanban board and Table List views, team comments, bulk updates, and RFC 4180 CSV export with formula injection protection.
  - Migration `0021_action_center.sql` with PostgreSQL RLS applied.

- Milestone 14 Integrations & Milestone 11 AI Traffic Analytics (Step 4.2 / ITG-FR-001 to ITG-FR-012, TRF-FR-001 to TRF-FR-009):
  - Third-party OAuth integration architecture for Google Search Console (read-only `webmasters.readonly`) and Google Analytics 4 (`analytics.readonly`) with OAuth tokens encrypted at rest via AES-256-GCM (`v1.iv.tag.ciphertext`).
  - GSC query synchronization and search analyzer (`GscAnalyzer`) detecting question-like queries, classifying intent (`informational`, `comparison`, `commercial`), and extracting high-priority prompt opportunities with mandatory disclosure: _"Google Search Console does not isolate AI Overview / AI Mode search traffic directly (TRF-FR-004)"_.
  - AI Referrer Classifier (`AiReferrerClassifier`) isolating web and app referral traffic from ChatGPT, Gemini, Perplexity, Claude, Copilot, DeepSeek into a dedicated AI Channel Group with mandatory disclosure: _"Observed: Some AI traffic arrives without a referrer header and is under-counted in web analytics (TRF-FR-003)"_.
  - AI Traffic Analytics engine (`TrafficAnalyticsService`) computing AI referral sessions, engagement rate, conversion rate vs traditional organic benchmark, conversion multiplier (e.g. 2.9x), engine breakdown, top landing pages, and crawl-to-citation-to-visit correlation (labeled **Modeled** per `TRF-FR-008`).
  - Public REST API key provisioning (`TokenCrypto.generateApiKey`) issuing `sk_live_...` credentials stored as SHA-256 hashes with scoped permissions and tier-based rate limits (default 60 req/min, burst 120 per `ITG-FR-012`).
  - Outbound event webhook streaming with HMAC-SHA256 signature verification (`X-Savoir-Signature: t=...,v1=...`) for `run.completed`, `action.verified`, `alert.created`, `audit.completed`, and `traffic.synced` events.
  - Interactive AI Traffic & Integrations Studio (`client/components/traffic-analytics.tsx`) and route `/traffic`.
  - Migration `0022_integrations_and_traffic.sql` with PostgreSQL RLS applied.

- Milestone 13 Reporting & Alerts (Step 5.1 / RPT-FR-001 to RPT-FR-011):
  - Executive cross-module intelligence dashboard synthesizing Visibility (M3), Citations (M6), Technical AEO (M8), Content (M9), AI Traffic (M11), and Action Velocity (M10) into a weighted composite **AEO Executive Readiness Index (0–100)** with standing classifications (`Leading`, `Competitive`, `Moderate`, `At Risk`).
  - Automated synthesis of period Key Wins and Critical Risks.
  - Statutory measurement disclosures (`RPT-FR-011`) distinguishing Observed telemetry metrics from Modeled/Inferred indices.
  - Real-time Alert Engine (`AlertEngineService`) implementing rule evaluation for:
    - Visibility drops with statistical significance ($p < 0.05$, $z \ge 1.96$ via normal CDF approximation).
    - Competitor overtakes with custom gap leads ($\Delta \ge 5\%$).
    - Lost brand citations and broken citation targets.
    - Crawl blockages (`robots.txt` AI user-agent disallow flags).
  - Cooldown deduplication window (default 24h, `RPT-FR-007`) preventing alert storms, with complete incident lifecycle triage (`active`, `acknowledged`, `resolved`, `dismissed`).
  - Multi-channel notification dispatch across in-app, webhook, and transactional email via encrypted Brevo outbox (`createEmailOutbox`).
  - Scheduled and on-demand report generator (`ReportGeneratorService`) compiling print-ready executive briefs (PDF/HTML/JSON) with automatic weekly/monthly recurrence calculations and Brevo email delivery.
  - Interactive Executive Reporting & Alerts Dashboard (`client/components/reporting-dashboard.tsx`) and route `/reporting`.
  - Migration `0023_reporting_and_alerts.sql` with PostgreSQL RLS applied.

- Milestone 15 Platform Administration & Stripe Billing (Step 5.2 / ADM-FR-001 to ADM-FR-014):
  - Stripe Checkout sessions (`/v1/billing/tenants/:tenantId/checkout`) and Customer Portal sessions (`/v1/billing/tenants/:tenantId/portal`) supporting 3 plan tiers: Starter ($99/mo, 2,000 monitoring credits, 500 crawl pages), Growth ($299/mo, 8,000 monitoring credits, 2,000 crawl pages), Enterprise ($899/mo, 30,000 monitoring credits, 10,000 crawl pages), plus a 1,000 credit top-up pack ($50).
  - Stripe Webhook handler (`/v1/billing/webhook`) verifying HMAC-SHA256 signatures (`stripe-signature` header: `t=...,v1=...`) with timing-safe comparison handling `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`.
  - Atomic credit ledger enforcement (`CreditLedgerService`): exactly 1 monitoring run = 1 credit, separate metering for crawls (1 page = 1 crawl credit) with transactional `SELECT ... FOR UPDATE` row locks, overdraft denial, and immutable append-only audit trail (`credit_ledger_entries`) recording running `balance_after`.
  - Internal Operator Console (`OperatorService` & `createOperatorMiddleware` enforcing `X-Operator-Key` against `OPERATOR_SECRET_KEY`):
    - Cross-tenant directory search, tier and status filtering (`/v1/operator/tenants`), and deep tenant profile inspection (`/v1/operator/tenants/:tenantId`).
    - Administrative tenant lifecycle controls (`/v1/operator/tenants/:tenantId/status`) supporting pause, resume, and archive actions with operator reason logging.
    - Discretionary manual credit adjustments (`/v1/operator/tenants/:tenantId/credits`) for monitoring and crawl balances with operator justification tracking.
    - Platform queue health telemetry (`/v1/operator/queues`) reporting active, waiting, delayed, failed, and paused jobs across monitoring runs, crawler audits, and email notifications.
    - Immutable operator audit logging (`operator_audit_logs`).
  - Interactive Frontend Views:
    - Billing & Credits Dashboard (`client/components/billing-dashboard.tsx`, route `/billing`) with tier comparisons, balance meters, top-up modal, Stripe portal launcher, and filterable credit ledger.
    - Operator Console (`client/components/operator-dashboard.tsx`, route `/operator`) with operator key authorization, tenant directory, modal controls, queue health cards, and operator audit trail.
  - Migration `0024_billing_and_admin.sql` with forced PostgreSQL RLS and tenant isolation policies applied.

Twenty-four migrations exist (`0001` through `0024`). Security policies and authentication functions are explicit SQL; preserve them when generating future migrations. Existing users are not silently verified. No test accounts are created in the developer database.

- Transactional mail foundation: Brevo adapter, encrypted outbox, leases/retries/deduplication, and separately gated notification worker. Registration and verification producers are implemented; live delivery remains untested.

## Still incomplete

Milestone 1 is partial: Google login, atomic tenant onboarding, broader consent/audit/lifecycle services, and operator APIs remain.

Milestones 2â€“9 product capabilities are not implemented. The foundation worker only handles a ping; it does not perform monitoring, crawling or billing.

## Earlier implementation order (superseded by the sequencing override below)

1. Brevo is selected; its adapter, encrypted outbox and gated worker are implemented. Configure the verified sender/API key when ready, complete remaining mail operational hardening, and connect account-lifecycle producers.
2. Registration, hashed verification codes, resend and breached-password checks are implemented. Password reset, atomic session revocation and notification enqueue are also implemented; next is Google login. Never log tokens; keep account-existence responses generic.
3. Add Google OAuth with state/PKCE, verified identity linking, and a dedicated callback policy.
4. Complete atomic Owner tenant creation, consent acceptance and user/account lifecycle. Test authenticated requests across tenants before adding project CRUD.
5. Add operator authorization separately from tenant Owners; finish API keys and security/admin auditing.
6. Implement configurable plan entitlements, credit reservations and durable collection-job dispatch before provider calls.
7. Continue milestones 3â€“9 from the approved roadmap.

## Decisions and launch scope

Owner-only tenant access, US-only storage, all SRS Core/Extended/optional features except invitations, other tenant roles and assignment to other members. Existing enum values remain for compatibility.

Brevo has been selected. Other live provider/CAPTCHA choices, pricing/quotas, hosting, secret management, analytics scale and human security/legal sign-offs remain gates. No external messages, purchases or deployments have been performed.

## Verification

See README.md for the latest completed commands and test counts. Hosted GitHub Actions has not yet been observed. Tests use disposable database/role/bucket/queue resources; production must never be used as the integration-test target.

Password-reset implementation and operational details: [password-reset.md](password-reset.md).

## Current sequencing override

The user deferred unfinished M1 and Google sign-in and requested M2 next. Gemini monitoring is implemented first; OpenAI awaits a key, and AI Overviews/AI Mode await a licensed vendor. See [monitoring.md](monitoring.md) for exact scope, configuration and remaining acceptance work.

Prompt-level schedule controls are implemented through POST /prompts/{id}/schedules/status and migration 0008. Shared schedules preserve other prompts; resume respects higher-level pauses; deletion retains run history. See monitoring.md for semantics and verification.

## Frontend integration

Next.js is implemented in client/ with JWT cookie sign-in and responsive views based on the supplied design. Read-only project discovery is available through GET /v1/projects; migration 0009 is applied locally. Existing Gemini monitoring endpoints are connected to prompt management, operational health, schedule creation/control and manual-run submission. Registration/verification/reset screens, OAuth, M1 onboarding, advanced prompt features, full analytics and other SRS modules are still pending. Backend checks: 28 unit/API tests and 64 integration tests passed at this checkpoint.

## Verified integration checkpoint — 6 November 2026

Backend: 28 unit/API tests and 64 integration tests passed. Frontend: 8 unit tests and 4 browser workflows passed, covering JWT sign-in/refresh/logout, project discovery, prompt changes, schedules, lost-response manual-run replay without duplicate reservation, unavailable providers, mobile navigation, and empty/error states. Type checks, lint, backend formatting and both production builds passed. Migration 0009 is applied locally. Browser tests used only a disposable database and synthetic provider results; no live Gemini calls or real email sends were made. Frontend production dependency audit reported zero findings; eight moderate development dependency findings remain, and no forced breaking dependency update was applied.
