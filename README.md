# AEO/GEO Optimization Platform — Savoir

> AI Answer Engine Optimization & Generative Engine Optimization SaaS Platform\
> **Backend:** Node.js + Express.js 5 + TypeScript\
> **Frontend:** Next.js 16 + React 19\
> **Database:** PostgreSQL 16 + pgvector + Drizzle ORM\
> **Queue:** BullMQ + Redis | **Storage:** MinIO (S3-compatible)

## Content Studio and Publishing

The content workflow now covers verified brand/product memory, customer-question
classification, multi-format generation, human review, and scheduled publishing.
Open **Content Intelligence → Open content studio**, or visit `/content/studio`.

| Phase | Capabilities | Documentation |
| :--- | :--- | :--- |
| 1. Brand & Product Memory | Approved brand rules and product facts, validity windows, Gemini embeddings, pgvector cosine retrieval | [Memory foundation](server/docs/brand-product-memory.md) |
| 2. Customer Q&A | Bulk JSON/CSV/ticket imports, four-stage intent classification, recommended formats, prioritized backlog | [Customer Q&A](server/docs/customer-qa.md) |
| 3. Multi-Format Studio | Facebook, Instagram, X threads, video scripts, podcasts, and blogs with independent factual and platform checks | [Content generation](server/docs/content-studio.md) |
| 4. Approval & Publishing | Revision-based human approval, live previews, public media uploads, Buffer scheduling, and WordPress articles with JSON-LD | [Publishing setup](server/docs/content-publishing.md) |

Saving edits clears the previous approval. A passed validation report allows an
owner to approve the exact saved revision; scheduling then locks that revision.
The publishing worker checks current facts again before dispatch. Buffer acceptance
or a mobile reminder does not mark a post published; publication must be confirmed.

Live publishing requires connected accounts and publicly reachable media hosting.
The application does not generate finished video or carousel image files; upload
those assets separately and choose attachments for each destination.

---

## Prerequisites

| Tool | Version |
| :--- | :--- |
| Node.js | ≥ 22.14.0 < 23 |
| npm | ≥ 10 |
| Docker Desktop | Latest |
| Git | Latest |

---

## Quick Start

Unless stated otherwise, start each command block from the repository root.

### Step 1 — Clone the repository

```bash
git clone https://github.com/md-abunayem/Savoir-AEO-GEO-Optimization-Platform.git
cd Savoir-AEO-GEO-Optimization-Platform
```

---

### Step 2 — Start infrastructure services (Docker)

Make sure **Docker Desktop** is running. From the repository root, create the
server environment file if it does not already exist, then configure its
PostgreSQL and MinIO credentials before starting the containers:

```bash
cd server
if [ ! -f .env ]; then cp .env.example .env; fi
# Edit .env before continuing.
docker compose up -d
```

This starts:

- **PostgreSQL 16 with pgvector** on `127.0.0.1:5432`
- **Redis 7** on `127.0.0.1:6379`
- **MinIO** (S3-compatible) on `127.0.0.1:9000`

Verify all containers are healthy:

```bash
docker compose ps
```

---

### Step 3 — Install dependencies

**Backend:**

```bash
cd server
npm install
```

**Frontend:**

```bash
cd client
npm install
```

---

### Step 4 — Configure environment

Configure `server/.env` using `server/.env.example`. Environment files are local
configuration and are not supplied by a fresh clone. Set `DATABASE_URL` for
migrations and `DATABASE_APP_URL` for the restricted runtime connection. Configure
authentication before using protected project and studio pages; see
[authentication setup](server/docs/authentication.md).

Create `client/.env.local` with the backend origin:

```dotenv
API_ORIGIN=http://127.0.0.1:8000
```

Set `CORS_ORIGIN=http://127.0.0.1:3000` in `server/.env` when using the frontend's
default local URL. Use matching browser origins if you choose a different host
or port.

Monitoring configuration belongs in `server/.env`, which is read by both the API
and monitoring worker. Values in `client/.env` do not configure the backend.
Set `MONITORING_ENABLED=true` and provide the keys for the engines you want:
`GEMINI_API_KEY` for Gemini, `OPENROUTER_API_KEY` for OpenRouter,
`OPENAI_API_KEY` for ChatGPT, and `SERP_PROVIDER_API_KEY` for Google AI
Overviews through Serper. Serper's Search endpoint does not provide Google AI
Mode, so that engine remains unavailable with this provider.
Blank or placeholder keys are treated as unconfigured. Keep provider keys out
of browser environment variables. Restart the API and monitoring worker after
changing their environment files, and run `npm run monitoring:dev` from `server/`
to process monitoring jobs locally. Selecting an engine does not verify its key
or provider quota.

Website audits also require `FIRECRAWL_API_KEY` in `server/.env`. Putting it in
`client/.env` does not enable the audit checkbox. `FIRECRAWL_API_URL` is optional;
the crawler defaults to `https://api.firecrawl.dev`. Restart the API after updating
these values and reload the project page to refresh connection availability.
Recurring technical audits also require the technical audit scheduler process:
run `npm run technical-audit:dev` from `server/` locally, or
`npm run technical-audit:start` in production. It uses the restricted database
runtime connection and Redis to dispatch due daily, weekly, and monthly crawls.

### Which sections use each provider?

| Section | Data source |
| :--- | :--- |
| Monitoring | Gemini or another selected, configured answer engine |
| Answer Explorer | Stored monitoring answers |
| Visibility | Stored monitoring answers and mentions |
| Citations | Stored monitoring citations |
| Competitors | Stored monitoring answers, mentions, and citations |
| Technical AEO | Firecrawl website snapshots and technical scoring |
| Content Intelligence | Crawl snapshots, prompts, and citation evidence |
| Customer Q&A | Imported questions and Gemini classification |
| Content Studio | Approved memory, Gemini generation, and fact checking |
| Publishing | Buffer/WordPress, public media, and the publishing worker |
| Action Center, Overview, Reporting | Aggregated findings |
| Agent Experience (AXO) | Policy drafts and live checks; no Gemini key |
| AI Traffic | Connected analytics and Search Console data |

Answer Explorer, Visibility, Citations, and Competitors use stored results without
calling Gemini directly. Q&A classification uses `GEMINI_API_KEY` and
`GEMINI_MODEL`; studio fact checking uses a separate model call from generation.
Neither Firecrawl nor Gemini supplies traffic statistics.

Working provider keys do not grant database access. Workspace services use the
authenticated owner and tenant context through the restricted runtime connection.
Apply all database migrations (`cd server` then `npm run db:migrate`), including
`0031_workspace_runtime_access`, to install the owner policies for content,
actions, integrations, AXO, and reporting tables. Restart the API after updating
backend code. Empty analytics may still require a completed monitoring collection
or website audit before there is evidence to display.

Monitoring supports choosing Gemini, OpenRouter, ChatGPT, or Google AI
Overviews when configured. Google AI Mode is listed for historical data but
is unavailable through Serper. Both manual runs and new schedules require an
available engine. Use the load-more controls to access older prompts, schedules,
and runs;
the batch limit remains 100 selected prompts and 500 combinations per collection.
Schedule creation accepts an optional `Idempotency-Key` header. The same key and
inputs replay the original creation result; changing the inputs returns 409.
Apply migration `0033_schedule_creation_requests` before deploying this version.

If Gemini reports `PROVIDER_HTTP_401` or `PROVIDER_AUTH_TOKEN_UNSUPPORTED`, run
`npm run monitoring:check` from `server/`. This reads model metadata without
generating content or reserving monitoring credits. A rejected credential must
be repaired or replaced in Google AI Studio and updated in `server/.env`; changing
the model or increasing quota does not fix authentication. Restart both the API
and monitoring worker after updating credentials. Failed runs remain historical
failures; use an explicit new collection after the metadata check succeeds.

Unidentified Gemini 429 responses no longer trigger automatic collection retries.
An explicit `Retry-After` or Google `RetryInfo` delay permits bounded retries;
zero, daily, and Search grounding quota rejections require review. Stopped runs
release their reserved monitoring credits. The Monitoring page provides a
`Stop quota retries` action for legacy queued rejections, and keeps long provider
diagnostics inside collapsible error details. Apply migration
`0034_stop_quota_retries` before deploying this version.

### OpenRouter GPT-6 Luna monitoring

Use `OPENROUTER_API_KEY` for an OpenRouter key, not `GEMINI_API_KEY` (which is sent
only to Google's native API). The default is `OPENROUTER_MODEL=openai/gpt-6-luna`.
The OpenRouter engine uses bearer authentication at
`https://openrouter.ai/api/v1/chat/completions`, enables native web search, disables
provider fallbacks, and caps model-token prices at $0.10/M input and $0.50/M output.
Search charges are separate and are not included in these token-price caps. Answers
are grounded only when the response includes structured source citations.

Apply `0035_openrouter_engine`, restart the API and monitoring worker, then select
**OpenRouter / GPT-6 Luna** in Monitoring or project setup. Run
`npm run monitoring:check -- --engine=openrouter` to check the key and configured
model using metadata only. This does not test generation, search, or quota availability.

---

### Step 5 — Run database migrations

From the repository root:

```bash
cd server
npm run db:migrate
```

For first-time setup, also provision the restricted runtime database role:

```bash
npm run db:provision-runtime
```

Migrations enable the PostgreSQL `vector` extension. The database server must have
pgvector installed and the migration connection must be allowed to enable it. The
included Docker Compose PostgreSQL image supplies pgvector. Apply all migrations,
including `0041_brand_product_memory`, `0042_customer_questions`, and
`0043_content_publishing`, before using the studio workflow.

### Enable content publishing

Configure these values in `server/.env` for both the API and publishing worker:

```dotenv
PUBLISHING_ENABLED=true
PUBLISHING_TOKEN_KEY=<64-random-hexadecimal-characters>
S3_PUBLIC_BUCKET=savoir-public-media
S3_PUBLIC_BASE_URL=https://media.example.com
```

Use an independent encryption key for publisher credentials. Generation and review
also require `GEMINI_API_KEY` and `GEMINI_MODEL`; they do not depend on monitoring
being enabled. Keep all provider tokens and encryption keys on the server.

The public bucket must be different from the private evidence bucket, `S3_BUCKET`.
Configure a stable HTTPS bucket/CDN URL reachable by Buffer. To configure public
object reads and browser upload CORS on a dedicated MinIO/S3 bucket, run from `server/`:

```bash
npm run storage:public:init
```

This command changes the named public-media bucket's access policy. It does not
make the private evidence bucket public. For a CDN with private origin access,
follow the alternative setup in the [publishing guide](server/docs/content-publishing.md).

In the studio, connect Buffer with an access token. For WordPress, install and
activate [Savoir Article Schema](server/integrations/wordpress/savoir-schema.php),
then connect the HTTPS site using a username and Application Password. The plugin
provides the REST-visible JSON-LD metadata required by the connector.

Start the publishing worker separately from the API:

```bash
npm run publishing:dev
# After building the server, use npm run publishing:start in production.
```

The worker uses `publishing-queue`; PostgreSQL holds the durable schedule. Provider
rate limits delay retries. Ambiguous external writes require reconciliation instead
of blind retries that could duplicate posts. Personal Instagram and other reminder-only
channels show mobile-approval notices in Delivery Activity until publication
is confirmed.

---

## ▶ Run Commands

### Backend (API Server)

```bash
cd server
npm run dev
```

> Runs on **<http://127.0.0.1:8000>**\
> Hot-reloads via `tsx watch`

| Other server commands | Description |
| :--- | :--- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm test` | Run server unit and HTTP tests |
| `npm run test:integration` | Test disposable local/CI infrastructure |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier auto-format |
| `npm run format:check` | Prettier format check (CI) |
| `npm run check` | CI: typecheck, lint, format, tests, and build |

---

### Frontend (Next.js App)

```bash
cd client
npm run dev
```

> Runs on **<http://127.0.0.1:3000>**\
> Hot-reloads via Next.js Turbopack

| Other client commands | Description |
| :--- | :--- |
| `npm run build` | Compile production Next.js build |
| `npm start` | Run compiled production build |
| `npm test` | Run client unit tests |
| `npm run typecheck` | TypeScript type check |
| `npm run lint` | ESLint check |
| `npm run check` | Full CI pipeline (typecheck + lint + test + build) |

---

### Background Workers

Monitoring requires Redis and the monitoring worker below. Apply database migrations
with `npm run db:migrate` before starting the API and worker.

The API saves accepted monitoring requests in PostgreSQL and wakes the BullMQ
dispatcher. The dispatcher creates a `monitoring-requests` job for each run;
Redis stores run IDs and engine names, never API keys or prompt text. PostgreSQL
remains the durable outbox, so the periodic dispatcher recovers requests after a
Redis outage. Database leases prevent concurrent jobs from making duplicate calls.

The request worker uses global concurrency of one and spaces calls using
`MONITORING_CALL_SPACING_SECONDS`. The existing daily call cap still applies.
Cached metadata checks reject invalid Gemini, OpenRouter and OpenAI credentials
before generation; licensed SERP adapters can only check configuration presence.
Temporary check outages defer requests without consuming generation attempts.

Provider retries use exponential backoff with jitter, respect explicit provider
retry delays, and remain bounded by the existing four-attempt limit. PostgreSQL
owns provider retries so BullMQ does not multiply them. Authentication failures,
unknown quota rejections, and ambiguous interrupted calls are not automatically
replayed. Queueing cannot increase a provider's free allowance; it does not rotate
keys or enable paid fallback.

Run these in separate terminals from `server/`:

```bash
# AI monitoring queue worker
npm run monitoring:dev

# Approved content publishing and outcome reconciliation
npm run publishing:dev

# General background task worker
npm run worker:dev

# Transactional email outbox worker
npm run email:dev
```

---

## Application URLs

| Service | URL |
| :--- | :--- |
| **Frontend App** | <http://127.0.0.1:3000> |
| **Content Studio** | <http://127.0.0.1:3000/content/studio> |
| **Backend API** | <http://127.0.0.1:8000> |
| **OpenAPI Specification** | <http://127.0.0.1:8000/v1/openapi.json> |
| **API Liveness** | <http://127.0.0.1:8000/v1/health/live> |
| **API Readiness** | <http://127.0.0.1:8000/v1/health/ready> |
| **MinIO Console** | <http://127.0.0.1:9001> |

---

## Project Structure

```text
AEO-GEO/
├── client/              # Next.js 16 frontend
│   ├── app/             # App router pages
│   ├── components/      # React components
│   └── lib/             # API client and types
├── server/              # Express.js backend
│   ├── src/
│   │   ├── config/      # OpenAPI, env, logger
│   │   ├── db/          # Drizzle schema & migrations
│   │   ├── middlewares/
│   │   ├── routes/
│   │   ├── services/    # Business logic by module
│   │   ├── validations/ # Zod schemas
│   │   └── workers/     # BullMQ queue workers
│   ├── drizzle/         # Versioned SQL migrations and tenant policies
│   ├── tests/           # Unit and integration tests
│   └── compose.yaml     # Docker Compose infrastructure
└── .github/
    └── workflows/       # CI: backend.yml, frontend.yml
```

---

## Implemented Modules

| Module | Name | Status |
| :--- | :--- | :---: |
| M1 | Project Onboarding | ✅ Complete |
| M2 | AI Engine Monitoring | ✅ Complete |
| M3 | AI Visibility Analytics | ✅ Complete |
| M4 | Prompt Intelligence | ⚠️ Partial |
| M5 | AI Answer Explorer | ✅ Complete |
| M6 | Citation Intelligence | ✅ Complete |
| M7 | Competitor Intelligence | ✅ Complete |
| M8 | Technical AEO Auditing | ✅ Complete |
| M9 | Content Intelligence | ✅ Complete |
| M10 | Optimization Action Center | ✅ Complete |
| M11 | AI Traffic Analytics | ✅ Complete |
| M12 | International & Local AEO | ⏳ Pending |
| M13 | Reporting & Alerts | ✅ Complete |
| M14 | Integrations (GSC / GA4) | ✅ Complete |
| M15 | Platform Administration & Billing | ✅ Complete |
| M16 | Agent Experience Optimization (AXO) | ✅ Complete |
| M17 | Data Collection & Measurement Engine | ✅ Complete |
| M18 | Legal, Privacy & Compliance | ⚠️ Partial |
| M19 | AI Search Grader | ✅ Complete |

---

## CI Status

GitHub Actions runs `npm run check` on every push to `server/**` and `client/**`:

- ✅ TypeScript type check
- ✅ ESLint
- ✅ Prettier format check
- ✅ Server and client unit tests
- ✅ Production build
- ✅ Integration tests (against disposable PostgreSQL + Redis + MinIO)

The studio additionally has a Playwright browser test covering live previews,
approval invalidation, review, and multi-destination scheduling on desktop and
mobile. With the client running, execute it from `client/`:

```bash
npm run test:e2e -- tests/browser/content-studio.spec.ts
```

That browser test mocks publishing APIs and does not send live posts. Automated
checks do not verify real Buffer/WordPress credentials or public media reachability;
validate those connections in the deployment environment before scheduling content.
