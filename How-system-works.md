# How Savoir AEO/GEO Platform Works

> [!NOTE]
> Savoir is a multi-tenant SaaS platform that tracks **how AI answer engines** (Gemini, ChatGPT, Google AI Overviews, etc.) mention, cite, and rank your brand — and gives you tools to optimize that visibility.

---

## 1. The Big Picture

```mermaid
flowchart TD
    USER["👤 User (Browser)"]

    subgraph Frontend["Next.js 16 — port 3000"]
        UI["App Router Pages"]
    end

    subgraph API["Express.js 5 API — port 8000"]
        MW["Middleware Stack\nAuth · CSRF · Tenant · Error"]
        ROUTES["Route Handlers"]
        SERVICES["Service Layer"]
    end

    subgraph Queue["BullMQ + Redis 7"]
        MQ["monitoring-requests queue"]
        AQ["answer-processing queue"]
        NQ["notification queue"]
        FQ["foundation queue"]
    end

    subgraph Workers["Background Workers"]
        MON["monitoring.worker\nnpm run monitoring:dev"]
        ANS["answer.worker (inside monitoring.worker)"]
        EMAIL["email.worker\nnpm run email:dev"]
        GEN["foundation.worker\nnpm run worker:dev"]
    end

    subgraph DB["PostgreSQL 16 (Drizzle ORM) — port 5432"]
        PG_OUTBOX["Durable Outbox\nmonitoring_runs table"]
        PG_ANS["answers · mentions · citations · claims"]
        PG_EMAIL["email_outbox table"]
        PG_TENANT["tenants · memberships · projects"]
    end

    subgraph Storage["MinIO S3 — port 9000"]
        S3["Evidence JSON files\nmonitoring/{tenant}/{project}/{run}/*.json"]
    end

    subgraph External["External APIs"]
        GEMINI["Google Gemini API"]
        OPENAI["OpenAI GPT-4o"]
        SERP["SERP Provider\nGoogle AI Overviews / AI Mode"]
        OR["OpenRouter / Gemma Free"]
        FC["Firecrawl\nWeb Crawler"]
        BREVO["Brevo\nTransactional Email"]
        GSC["Google Search Console"]
        GA4["Google Analytics 4"]
        STRIPE["Stripe Billing"]
    end

    USER --> Frontend --> MW --> ROUTES --> SERVICES
    SERVICES --> DB
    SERVICES --> Queue
    SERVICES --> Storage

    MON --> PG_OUTBOX
    MON --> GEMINI & OPENAI & SERP & OR
    MON --> S3
    MON --> AQ

    ANS --> PG_ANS

    EMAIL --> PG_EMAIL --> BREVO

    GEN --> FQ

    SERVICES --> FC
    SERVICES --> GSC & GA4
    SERVICES --> STRIPE
```

---

## 2. User Flow — From Signup to Insights

### Step 1 — Auth
- User signs up / logs in via `/auth` (cookie-based JWT: `savoir_access` + `savoir_refresh`).
- Google OAuth callback lands at `/auth/callback/google`.
- Every API request goes through **`authenticate()` middleware**, which reads the `savoir_access` cookie, validates the JWT, and resolves a `TenantContext { userId, tenantId }`.
- All database queries run in a **restricted PG role** with Row-Level Security — the middleware sets `app.user_id` and `app.tenant_id` session config vars so PG policies automatically filter to the right tenant.

### Step 2 — Onboarding / Project Setup
- User creates a **Project** (a website/brand they want to track).
- Adds tracking **Prompts** — the questions they want AI engines to answer (e.g., "What is the best CRM for startups?").
- Optionally adds **Competitors** and sets a monitoring schedule.

### Step 3 — Monitoring Collections (the core loop)

```mermaid
sequenceDiagram
    participant U as User (UI)
    participant API as Express API
    participant PG as PostgreSQL
    participant Redis as Redis (BullMQ)
    participant W as monitoring.worker
    participant AI as AI Provider
    participant S3 as MinIO S3
    participant AW as answer.worker

    U->>API: POST /monitoring/runs (start collection)
    API->>PG: INSERT into monitoring_runs (status=queued) [durable outbox]
    API->>Redis: Add job to monitoring-requests queue
    API-->>U: 202 Accepted

    W->>PG: CALL savoir_monitoring_claim() [atomic DB lease]
    PG-->>W: ClaimedRun (runId, engine, prompt, geo…)
    W->>AI: Execute prompt (Gemini / GPT-4o / SERP / Gemma)
    AI-->>W: Answer text + citations + search queries + latency
    W->>S3: PUT evidence JSON (redacted)
    W->>PG: CALL savoir_monitoring_finish() [status=completed]
    W->>Redis: Enqueue parse-answer job → answer-processing queue

    AW->>PG: Fetch completed run + brand/competitor config
    AW->>AW: Extract entities · citations · brand claims
    AW->>PG: INSERT answers · mentions · citations · claims
```

**Key design decisions:**
- **PostgreSQL = durable outbox.** The API writes the run to PG _before_ touching Redis. If Redis goes down, a periodic dispatcher re-reads PG and re-enqueues. Redis only holds run IDs — never prompts, API keys, or answer text.
- **DB leases via stored procedures** (`savoir_monitoring_claim`) prevent two workers from processing the same run.
- **Exponential backoff with jitter** — retries respect provider `Retry-After` headers; 429s are bounded to 4 attempts; auth failures and unknown quota rejections are _not_ retried automatically.
- **Evidence is redacted** before storage — emails and PII are stripped server-side.

---

## 3. Answer Processing Pipeline

After a run completes, `answer.worker` calls `processAnswerForRun()`:

```mermaid
flowchart LR
    RAW["Raw AI Answer\n(text + citations)"]
    ENT["entity-extractor\nBrand & Competitor Mentions"]
    CIT["citation-extractor\nURL Citation Links"]
    CLAIM["claims-extractor\nBrand Attribute Claims"]
    DB["PostgreSQL\nanswers · mentions · citations · claims"]

    RAW --> ENT & CIT & CLAIM --> DB
```

This parsed data powers:
- **Answer Explorer** — browse raw AI answers per prompt
- **Visibility Analytics** — mention rate, position, sentiment trends
- **Citation Intelligence** — which URLs AI engines cite for your topics
- **Competitor Intelligence** — how competitors appear vs. your brand

---

## 4. AI Engine Support

| Engine | Adapter | Auth |
|:---|:---|:---|
| Google Gemini | `gemini.adapter.ts` | `GEMINI_API_KEY` (Google AI Studio) |
| OpenAI GPT-4o | `openai.adapter.ts` | `OPENAI_API_KEY` |
| Google AI Overviews / AI Mode | `serp.adapter.ts` | `SERP_PROVIDER_API_KEY` |
| OpenRouter / Gemma Free | `openrouter.adapter.ts` | `OPENROUTER_API_KEY` |

The **`MultiEngineProvider`** wraps all adapters — a single `execute(request)` call routes to the right provider based on `request.engine`. A **canary test** (asking "Name one landmark in Paris.") validates credentials without consuming monitoring credits.

---

## 5. Technical AEO Auditing

Powered by **Firecrawl** (`FIRECRAWL_API_KEY`):
- Crawls the user's website on demand.
- `technical-audit.service.ts` runs the **AEO Rule Engine** to score structured data, page speed, schema markup, robots.txt, `llms.txt`, and content structure.
- Results feed **Content Intelligence** (page-level optimization briefs) and the **Action Center** (prioritized fix list).

---

## 6. Remaining Modules

| Module | How it works |
|:---|:---|
| **AI Traffic Analytics** | Connects Google Search Console + GA4 via OAuth; `gsc-analyzer.ts` + `traffic-analytics.service.ts` classify AI referrers |
| **Reporting & Alerts** | `alert-engine.service.ts` evaluates thresholds; `report-generator.service.ts` assembles PDF/data exports |
| **Billing** | `stripe.adapter.ts` + `credit-ledger.service.ts` track monitoring credit consumption; Stripe webhooks handle plan changes |
| **Agent Experience (AXO)** | `axo.service.ts` + `robots-policy-builder.ts` draft and validate `robots.txt` / `llms.txt` AI crawl policies |
| **AI Search Grader** | `grader.service.ts` generates a shareable score card (`/grader/[shareToken]`) without requiring login |
| **Email** | Brevo transactional email via PG outbox pattern — the email worker polls every 5 s and sends up to 10 messages per tick |
| **Admin / Operator** | `operator.service.ts` provides a super-admin panel for user management, tenant oversight, and global config |

---

## 7. Security Model

```mermaid
flowchart TD
    REQ["Incoming HTTP Request"]
    AUTH["authenticate() middleware\nValidates savoir_access JWT cookie"]
    CSRF["csrf.middleware\nDouble-submit cookie"]
    TENANT["TenantContext injected\napp.user_id + app.tenant_id"]
    RLS["PostgreSQL Row-Level Security\nPolicies filter all queries to tenant"]
    RESTRICTED["Restricted DB role\nNo superuser · No bypass RLS · No create"]

    REQ --> CSRF --> AUTH --> TENANT --> RLS
    RLS --> RESTRICTED
```

- **No superuser DB role** in production — both the API and workers verify at startup that `rolsuper = false` and `rolbypassrls = false`.
- **Membership check** in every `withTenant()` call: confirms the user is an `owner` of the requested tenant before executing any query.
- **CSRF protection** on all state-changing routes.
- **Provider API keys** live only in `server/.env` — never sent to the browser or stored in Redis.

---

## 8. Data Flow Summary

```mermaid
flowchart LR
    subgraph Input
        PROMPTS["User Prompts\n+ Schedules"]
        CRAWL["Firecrawl\nWebsite Snapshots"]
        ANALYTICS["GSC + GA4\nTraffic Data"]
    end

    subgraph Processing
        AI_ENGINES["AI Engines\nGemini · GPT · SERP · Gemma"]
        PIPELINE["Answer Pipeline\nEntity · Citation · Claim Extraction"]
        AUDIT["AEO Audit\nRule Engine Scoring"]
    end

    subgraph Output
        VISIBILITY["Visibility\n& Monitoring"]
        CITATIONS["Citation\nIntelligence"]
        COMPETITORS["Competitor\nIntelligence"]
        TECHNICAL["Technical AEO\nAudit Reports"]
        CONTENT["Content\nIntelligence"]
        ACTIONS["Action Center\nPrioritized Fixes"]
        TRAFFIC["AI Traffic\nAnalytics"]
        REPORTS["Reporting\n& Alerts"]
    end

    PROMPTS --> AI_ENGINES --> PIPELINE --> VISIBILITY & CITATIONS & COMPETITORS
    CRAWL --> AUDIT --> TECHNICAL & CONTENT --> ACTIONS
    ANALYTICS --> TRAFFIC
    VISIBILITY & TECHNICAL & TRAFFIC --> REPORTS
```
