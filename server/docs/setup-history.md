# AEO/GEO Optimization Platform — Backend Developer README

> **Project:** AEO/GEO Optimization Platform  
> **Workspace:** Savoir  
> **Backend:** Node.js + Express.js 5 + TypeScript  
> **Database:** PostgreSQL 16 + Drizzle ORM  
> **Last updated:** November 4, 2026  
> **Document purpose:** Team onboarding, backend configuration, architecture, and implementation guidelines  
> **Reference:** AEO/GEO Platform Software Requirements Specification (SRS), Version 1.0 Draft

---

## 1. Introduction

This README describes the backend architecture, technologies, packages, configurations, current development progress, and implementation guidelines for the AEO/GEO Optimization Platform.

It is intended to help every team member understand:

- What the platform is and what we are building.
- What technologies we have selected and why.
- Which configurations have already been completed.
- What every major dependency is responsible for.
- How to run the project locally.
- How our database, Docker services, and background processing will work.
- Where new code should be written.
- What remains to be configured or implemented.
- How teammates should collaborate without creating incompatible implementations.

**Important:** This document distinguishes between verified work, existing project structure, and planned features. A package being installed does not necessarily mean its integration is complete.

## 2. Project Overview

AEO stands for **Answer Engine Optimization**, while GEO stands for **Generative Engine Optimization**.

Our platform is a multi-tenant SaaS application designed to help businesses improve and monitor their visibility across AI-powered answer engines.

The platform will help users answer questions such as:

- Does ChatGPT or Gemini mention my brand?
- How frequently does my brand appear in AI-generated answers?
- Which competitors are mentioned more often?
- Which websites are cited as sources?
- How do AI engines describe my brand?
- What changes could improve AI visibility?
- Are technical website issues preventing AI engines from accessing important content?

The platform will collect AI answers, analyze brand mentions, extract citations, monitor competitors, evaluate website accessibility, and provide actionable recommendations.

### 2.1 Core platform capabilities

The SRS defines 19 functional modules.

| Module | Name | Scope |
|---|---|---|
| M1 | Project Onboarding | MVP Core |
| M2 | AI Engine Monitoring | MVP Core |
| M3 | AI Visibility Analytics | MVP Core |
| M4 | Prompt Intelligence | Core + Extended |
| M5 | AI Answer Explorer | MVP Core |
| M6 | Citation Intelligence | MVP Core |
| M7 | Competitor Intelligence | Core + Extended |
| M8 | Technical AEO Auditing | MVP Core |
| M9 | Content Intelligence | MVP Extended |
| M10 | Optimization Action Center | Core Tasks + Extended Verification |
| M11 | AI Crawler & Traffic Analytics | MVP Extended |
| M12 | International & Local AEO | MVP Extended |
| M13 | Reporting & Alerts | Core Dashboard + Extended |
| M14 | Integrations & AI Agents | Core GSC/GA4 + Extended |
| M15 | Platform Administration | MVP Core |
| M16 | Agent Experience Optimization | MVP Extended |
| M17 | Data Collection & Measurement Engine | MVP Core |
| M18 | Legal, Privacy & Compliance | MVP Core |
| M19 | AI Search Grader & Brand Perception | MVP Core |

The SRS is the source of truth for feature behavior, priorities, acceptance criteria, and non-functional requirements.

### 2.2 Important product principles

The system must:

1. Use official AI APIs or appropriately licensed third-party providers.
2. Avoid scraping the consumer ChatGPT interface.
3. Support multiple organizations with proper data isolation.
4. Store original AI responses for verification and future reprocessing.
5. Calculate transparent and reproducible metrics.
6. Clearly distinguish Observed, Modeled, and Estimated results.
7. Enforce usage quotas and AI-provider cost limits.
8. Respect applicable privacy, crawling, and provider policies.
9. Provide a no-login public AI Search Grader with strict abuse controls.
10. Remain maintainable as the number of tenants, prompts, runs, and integrations increases.

---

## 3. Our Technology Stack

The SRS recommends several possible backend frameworks. Our implementation decision is to use **Express.js 5 with TypeScript**.

| Layer | Technology | Responsibility |
|---|---|---|
| Runtime | Node.js | Execute backend JavaScript |
| Backend framework | Express.js 5 | REST APIs and middleware |
| Language | TypeScript | Type safety and maintainability |
| Database | PostgreSQL 16 | Relational application data |
| ORM | Drizzle ORM | Type-safe database queries |
| Database driver | `pg` | PostgreSQL connections |
| Migration tool | Drizzle Kit | Schema migrations |
| Cache and queue backend | Redis 7 | Fast state and job coordination |
| Background jobs | BullMQ | Monitoring, crawling, reports |
| Object storage | S3-compatible storage | Raw responses and files |
| Local storage implementation | Silo/MinIO-compatible service | Local development object storage |
| Storage SDK | AWS SDK for S3 | Object upload and retrieval |
| API validation | Zod | Runtime input validation |
| Containerization | Docker Compose | Local infrastructure |
| AI providers | OpenAI, Google Gemini | AI-answer collection |
| Crawling | Firecrawl | Website extraction and audits |
| Billing | Stripe | Subscriptions and usage billing |
| Analytics database | ClickHouse | Future high-volume analytics |
| CI/CD | GitHub Actions | Automated checks and deployment workflows |

Not every technology in this table is implemented yet.

## 4. Current Configuration Status

### 4.1 Successfully verified

The following work is supported by our terminal output:

| Component | Verified state |
|---|---|
| Node/npm | npm commands execute |
| Docker Compose | Infrastructure containers started |
| PostgreSQL | Running and accepting migrations |
| Redis | Container running |
| S3-compatible storage | Container running |
| Drizzle Kit configuration | Recognized successfully |
| Drizzle migration generation | Successful |
| First database migration | Successful |
| `users` table | Created in PostgreSQL |
| npm package installation | Completed with warnings |
| npm registry connection | HTTP connection successful |
| Security audit | Four moderate findings identified |

Our Docker containers were reported as:

```text
server-postgres-1   Running
server-redis-1      Running
server-minio-1      Running
```

We successfully executed:

```bash
npx drizzle-kit generate --config=drizzle.config.ts

npx drizzle-kit migrate --config=drizzle.config.ts
```

Drizzle generated:

```text
drizzle/0000_numerous_the_stranger.sql
```

And PostgreSQL confirmed:

```text
Schema | Name  | Type  | Owner
-------+-------+-------+----------
public | users | table | aeo_user
```

### 4.2 Not yet verified

The following still need implementation or testing:

- Remaining database tables and relationships.
- Restricted PostgreSQL application role.
- PostgreSQL Row-Level Security (RLS).
- Authentication and role-based access control.
- Redis connectivity from Express.
- BullMQ workers and job processing.
- S3 bucket creation and object operations.
- AI provider integrations.
- Automated test suite.
- Backend build and health endpoint.
- Centralized logging and API documentation.
- GitHub Actions CI.
- Fresh-clone setup by all teammates.

Do not mark these complete until corresponding tests pass.

---

## 5. Project Folder Structure

Our existing project has the following Express.js layout, with database and future implementation folders added as needed.

```text
Savoir/
│
├── client/
│   └── ...
│
└── server/
    │
    ├── node_modules/
    ├── public/
    │
    ├── src/
    │   ├── config/
    │   ├── constants/
    │   ├── controllers/
    │   ├── db/
    │   │   ├── index.ts
    │   │   └── schema.ts
    │   ├── middlewares/
    │   ├── routes/
    │   ├── types/
    │   ├── utils/
    │   │   ├── ApiError.ts
    │   │   ├── ApiResponse.ts
    │   │   └── asyncHandler.ts
    │   ├── validations/
    │   │
    │   ├── services/          # Planned
    │   ├── jobs/              # Planned
    │   ├── workers/           # Planned
    │   │
    │   ├── app.ts
    │   └── index.ts
    │
    ├── drizzle/
    ├── tests/                 # Planned / verify
    ├── setup/                 # Optional configuration pack
    │
    ├── .env
    ├── .env.example           # To be finalized
    ├── .gitignore             # To be verified
    ├── compose.yaml
    ├── drizzle.config.ts
    ├── package.json
    ├── package-lock.json
    └── tsconfig.json
```

The actual existing screenshot showed the controllers, middleware, routes, utility, validation, configuration, and entry-point structure. New folders marked planned should be created when the corresponding work begins.

### 5.1 Folder responsibilities

**`src/config/`**

Stores application configuration, environment validation, and service-specific configuration.

Examples: environment validation, CORS options, authentication settings, and external service configuration.

**`src/constants/`**

Stores reusable constant values such as roles, application limits, event names, and error codes.

**`src/controllers/`**

Contains Express HTTP request handlers. Controllers should be thin: validate the request, invoke the relevant service, and return a consistent response.

**`src/services/`**

Planned home for business logic. Services should handle database operations, authorization-sensitive workflows, background-job creation, and coordination with provider adapters.

**`src/db/`**

Contains database configuration and table definitions. Database access must use the approved connection and tenant-isolation strategy.

**`src/middlewares/`**

Contains authentication, authorization, validation, logging, rate limiting, error handling, and other reusable request-processing functions.

**`src/routes/`**

Defines API endpoints and connects each endpoint with its middleware and controller.

**`src/types/`**

Stores shared TypeScript types and interfaces.

**`src/utils/`**

Contains general-purpose reusable helpers. Existing utilities such as `ApiError`, `ApiResponse`, and `asyncHandler` should be reviewed and reused consistently.

**`src/validations/`**

Contains Zod schemas for validating request bodies, query parameters, URL parameters, and other external data.

**`src/jobs/` and `src/workers/`**

Planned folders for BullMQ queue definitions, job creation, schedulers, and background processors.

**`src/app.ts`**

Configures the Express application, global middleware, routes, and centralized error handling.

**`src/index.ts`**

The existing backend entry point, responsible for starting the application and initializing required services.

---

## 6. Package Documentation

This section explains the packages selected, installed, or discussed for our platform.

**Important:** The tables are a dependency guide, not a verified list of installed packages. The authoritative installed versions are in `package.json` and `package-lock.json`.

### 6.1 Main backend dependencies

| Package | Purpose | Usage in our project |
|---|---|---|
| `express` | Node.js HTTP framework | Routes, APIs, middleware |
| `cors` | Browser cross-origin request controls | Frontend/backend communication |
| `dotenv` | Loads `.env` values | Environment configuration |
| `cookie-parser` | Parses cookies | Cookie-based sessions or refresh tokens |
| `helmet` | Adds security-related HTTP headers | API security middleware |
| `bcrypt` | Hashes and verifies passwords | Email/password authentication |
| `zod` | Runtime schema validation | Request and environment validation |
| `drizzle-orm` | Type-safe database queries | PostgreSQL operations |
| `pg` | PostgreSQL driver and connection pool | Database connectivity |
| `ioredis` | Redis client | Queues, selected caching |
| `bullmq` | Background job queue system | AI monitoring and other workers |
| `@aws-sdk/client-s3` | S3-compatible object storage client | File and evidence storage |
| `@aws-sdk/s3-request-presigner` | Creates temporary signed object URLs | Controlled evidence access |

### 6.2 Express.js

Express is our selected backend framework.

It handles HTTP requests, routing, middleware execution, and responses.

Example:

```typescript
import express from "express";

const app = express();

app.use(express.json());

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "API is running",
  });
});

export default app;
```

This is an illustrative endpoint, not confirmation that it is already implemented.

### 6.3 CORS

CORS determines which browser origins may access our API.

For local development, the expected frontend origin is:

```dotenv
CORS_ORIGIN=http://localhost:3000
```

CORS is not an authentication or authorization mechanism. The backend must still validate users and permissions.

### 6.4 Helmet

Helmet configures HTTP response headers that help mitigate common browser-related security risks.

It should be registered globally during Express application setup, with appropriate policies for our API and documentation endpoints.

### 6.5 Bcrypt

Bcrypt is used for password hashing.

We must never save plaintext passwords in PostgreSQL.

A simplified example:

```typescript
import bcrypt from "bcrypt";

const passwordHash = await bcrypt.hash(
  password,
  12
);

const isValid = await bcrypt.compare(
  password,
  passwordHash
);
```

Authentication, password reset, throttling, and session management remain to be implemented.

### 6.6 Zod

Zod validates incoming values at runtime.

TypeScript checks types during development, but it cannot guarantee that external HTTP requests contain valid data.

Example:

```typescript
import { z } from "zod";

export const createProjectSchema = z.object({
  brandName: z.string().min(1).max(100),

  domain: z.string().min(1),
});
```

Domain validation also requires proper normalization and security checks. A simple string schema is not enough for the SRS's outbound-fetch/SSRF protection.

### 6.7 Drizzle ORM

Drizzle connects TypeScript application code to PostgreSQL through a SQL-oriented, type-safe query API.

We selected Drizzle because our platform needs detailed control over PostgreSQL, migrations, tenant-scoped queries, indexes, and RLS.

It does not replace PostgreSQL security policies or application authorization.

### 6.8 PostgreSQL driver — `pg`

The `pg` package provides PostgreSQL connections and connection pooling.

Drizzle uses this driver to execute queries.

A connection pool avoids creating a new network connection for every request.

### 6.9 Redis and ioredis

Redis is a fast in-memory data store.

In our architecture, it supports background-job state, selected caching, and rate-limiting infrastructure.

The `ioredis` package allows Node.js to communicate with Redis.

Redis does not replace our persistent PostgreSQL database.

### 6.10 BullMQ

BullMQ is used to execute operations asynchronously using Redis.

Examples include:

- Monitoring AI engines.
- Crawling websites.
- Processing AI-generated answers.
- Calculating analytics.
- Generating reports.
- Sending notifications.

These operations may take much longer than an ordinary HTTP request.

Instead of waiting for them in a controller, the API will enqueue jobs for background workers.

### 6.11 AWS SDK for S3

`@aws-sdk/client-s3` provides the object-storage operations required to upload and retrieve files.

Our local Docker service exposes an S3-compatible API.

Examples of data to store:

- Original AI response JSON.
- Website HTML and Markdown snapshots.
- Generated PDF reports.
- Export files.
- Evidence artifacts.

`@aws-sdk/s3-request-presigner` can produce temporary signed URLs where secure client-side artifact access is appropriate.

Objects must remain private and tenant-scoped.

### 6.12 Planned external integration packages

| Package | Function | Intended use |
|---|---|---|
| `openai` | OpenAI API client | AI monitoring and classification |
| `@google/genai` | Gemini API client | Gemini monitoring |
| Firecrawl SDK | Website crawling and extraction | Technical AEO audits |
| `googleapis` | Google APIs and OAuth | Google Search Console |
| `@google-analytics/data` | GA4 reporting API | Traffic analytics |
| `stripe` | Billing and payment APIs | Subscriptions and metering |
| `swagger-ui-express` | Displays OpenAPI docs | API documentation |
| `@sentry/node` | Error monitoring | Runtime error tracking |
| OpenTelemetry packages | Distributed tracing | API/worker observability |

These integrations are planned or discussed; their installation and operation must be verified individually. Firecrawl SDK package naming and version should be confirmed before installation.

### 6.13 Development dependencies

| Package | Function |
|---|---|
| `typescript` | Compiles and type-checks TypeScript |
| `tsx` | Executes TypeScript during development |
| `drizzle-kit` | Generates and applies SQL migrations |
| `@types/node` | Node.js type definitions |
| `@types/express` | Express types |
| `@types/cors` | CORS type definitions |
| `@types/cookie-parser` | Cookie parser types |
| `@types/bcrypt` | Bcrypt types, where required |
| `@types/pg` | PostgreSQL driver types |
| `@types/swagger-ui-express` | Swagger UI types |
| `eslint` | Code linting; configuration pending |
| `prettier` | Code formatting; configuration pending |
| `vitest` | Automated testing; configuration pending |
| `supertest` | HTTP API testing; optional |

To inspect actual installed dependencies:

```bash
npm ls --depth=0
```

To inspect specific dependencies:

```bash
npm ls drizzle-orm drizzle-kit pg
```

Once dependencies are committed in the lockfile, teammates should use `npm ci` instead of reinstalling packages individually.

---

## 7. Docker Infrastructure

We use Docker Compose to run local infrastructure consistently across development machines.

Our current infrastructure services are PostgreSQL, Redis, and S3-compatible object storage.

### 7.1 PostgreSQL

PostgreSQL stores relational records such as:

- Users and organizations.
- Memberships and permissions.
- Projects and brands.
- Prompts and monitoring schedules.
- Normalized AI monitoring results.
- Citations and competitors.
- Billing and usage records.
- Audit logs.

### 7.2 Redis

Redis provides queue coordination and fast temporary state.

BullMQ uses Redis to manage queued, active, completed, and failed jobs.

### 7.3 S3-compatible object storage

The Compose service is named `minio`, although its image was changed to a Silo alternative because an earlier MinIO image pull failed.

It is used for file and evidence storage.

The intended local endpoints are:

```text
S3 API:
http://localhost:9000

Storage console:
http://localhost:9001
```

The intended private bucket is:

```text
aeo-evidence
```

The bucket and actual application upload/download operations have not yet been verified.

### 7.4 Start Docker services

From `Savoir/server`:

```bash
docker compose up -d postgres redis minio
```

Check status:

```bash
docker compose ps
```

Test PostgreSQL:

```bash
docker compose exec postgres pg_isready -U aeo_user -d aeo_geo
```

Test Redis:

```bash
docker compose exec redis redis-cli ping
```

Expected Redis response:

```text
PONG
```

### 7.5 Stop containers

```bash
docker compose down
```

Avoid using `docker compose down -v` for routine shutdown because it deletes attached volumes and their persisted data.

---

## 8. Environment Variables

All credentials and environment-specific values should be stored in `.env` locally.

Never commit `.env` to Git.

The team must commit a sanitized `.env.example`.

An example configuration is:

```dotenv
# Application
NODE_ENV=development
PORT=8000
CORS_ORIGIN=http://localhost:3000

# PostgreSQL
POSTGRES_USER=aeo_user
POSTGRES_PASSWORD=REPLACE_WITH_LOCAL_PASSWORD
POSTGRES_DB=aeo_geo

# Migration/admin connection
DATABASE_URL=postgresql://aeo_user:REPLACE_WITH_LOCAL_PASSWORD@localhost:5432/aeo_geo

# Restricted application connection - configure later
DATABASE_APP_URL=postgresql://aeo_app:REPLACE_WITH_APP_PASSWORD@localhost:5432/aeo_geo

# Redis
REDIS_URL=redis://localhost:6379

# S3-compatible local storage
MINIO_ROOT_USER=REPLACE_WITH_STORAGE_USER
MINIO_ROOT_PASSWORD=REPLACE_WITH_STORAGE_PASSWORD

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=aeo-evidence
S3_ACCESS_KEY_ID=REPLACE_WITH_STORAGE_USER
S3_SECRET_ACCESS_KEY=REPLACE_WITH_STORAGE_PASSWORD

# External integrations - configure when needed
OPENAI_API_KEY=
GEMINI_API_KEY=
FIRECRAWL_API_KEY=
STRIPE_SECRET_KEY=
```

The credentials must match the values used by Docker and database-role configuration.

The application should eventually use `DATABASE_APP_URL`, while migrations continue to use `DATABASE_URL`.

If Express runs inside Docker, internal service hostnames will be `postgres`, `redis`, and `minio` instead of `localhost`.

---

## 9. PostgreSQL and Drizzle ORM

### 9.1 Current database status

Our first migration has been applied.

The database currently has one verified application table:

```text
users
```

The initial schema includes:

| Column | Purpose |
|---|---|
| `id` | UUID primary key |
| `name` | User name |
| `email` | Unique email |
| `password_hash` | Optional password hash |
| `created_at` | Creation timestamp |
| `updated_at` | Update timestamp |

### 9.2 Database configuration file

Location:

```text
server/drizzle.config.ts
```

Its purpose is to tell Drizzle Kit:

- Which database dialect to use.
- Where schema definitions live.
- Where migration files should be generated.
- Which database URL should be used for migrations.

### 9.3 Database schema file

Location:

```text
server/src/db/schema.ts
```

This file defines tables, columns, foreign keys, constraints, indexes, and enum types.

### 9.4 Database connection file

Location:

```text
server/src/db/index.ts
```

This file manages the `pg` connection pool and exports the Drizzle database interface.

### 9.5 Generating migrations

Whenever a developer modifies a database schema:

```bash
npx drizzle-kit generate --config=drizzle.config.ts
```

Drizzle creates a SQL migration representing those changes.

Review the generated SQL before applying it.

### 9.6 Applying migrations

```bash
npx drizzle-kit migrate --config=drizzle.config.ts
```

### 9.7 Viewing database tables

```bash
docker compose exec postgres psql -U aeo_user -d aeo_geo -c "\dt"
```

### 9.8 Important migration rules

- Never delete or casually rewrite applied migrations.
- Commit migration SQL and metadata with schema changes.
- All teammates should apply the same committed migrations.
- Use new migrations for future schema changes.
- Review destructive migrations and data backfills carefully.
- Test migrations against a clean database before merging.

For a fresh clone, teammates generally run `migrate`, not `generate`.

---

## 10. Multi-Tenant Architecture

Our platform serves many organizations.

Each organization is called a **tenant**.

A user may belong to one or more tenants, and each tenant may manage multiple projects.

Expected data relationships:

```text
Users
  |
  v
Memberships
  |
  v
Tenants
  |
  v
Projects
  |
  +---- Prompts
  |
  +---- AI Monitoring Runs
  |
  +---- AI Answers
  |
  +---- Competitors
  |
  +---- Citations
  |
  +---- Audits
  |
  +---- Recommendations
```

### 10.1 Next tables to implement

| Table | Purpose |
|---|---|
| `tenants` | Customer organizations |
| `memberships` | User-tenant relationships and roles |
| `projects` | Brands/websites belonging to a tenant |

These tables were proposed previously but have not been confirmed migrated.

### 10.2 PostgreSQL Row-Level Security

The SRS requires PostgreSQL RLS in addition to application authorization.

Adding `tenant_id` columns is necessary, but not sufficient.

We need:

1. A restricted PostgreSQL runtime role.
2. Tenant ownership fields on appropriate tables.
3. RLS policies.
4. Authenticated and authorized tenant context.
5. Transaction-scoped database operations.
6. Automated isolation tests.

The current `aeo_user` is the database bootstrap/migration account and must not serve as the ordinary application account.

We must verify that Tenant A cannot access Tenant B's data, even when an attacker modifies IDs in requests.

Do not expose tenant-owned CRUD APIs before these protections are implemented and tested.

---

## 11. Backend Request Flow

A typical authenticated backend request should follow this pattern:

```text
Client
  |
  v
Express Middleware
  |
  v
Route
  |
  v
Input Validation
  |
  v
Authentication
  |
  v
Authorization / Tenant Access
  |
  v
Controller
  |
  v
Service
  |
  +---- PostgreSQL
  |
  +---- Redis/BullMQ
  |
  +---- Object Storage
  |
  +---- External Provider
  |
  v
API Response
```

Controllers should not contain large amounts of database, AI provider, or business logic.

Services and adapters should remain independently testable.

### 11.1 API conventions

The team should standardize the following:

- Versioned REST endpoints.
- Consistent request validation.
- Consistent success and error responses.
- Stable error codes.
- Correct HTTP status codes.
- Cursor pagination for lists.
- Authentication and authorization checks.
- Request correlation IDs.
- Idempotency for operations that spend credits.
- OpenAPI 3.1 documentation.

The SRS specifies RFC 9457-style error details, rate-limit responses, and a separate public Grader API.

---

## 12. AI Monitoring Architecture

Our AI monitoring engine is one of the most important parts of the platform.

A typical monitoring workflow will be:

```text
User activates a project
          |
          v
Monitoring schedule created
          |
          v
Jobs added to BullMQ
          |
          v
Worker picks up job
          |
          v
Provider adapter calls AI API
          |
          v
Original response stored in S3
          |
          v
Normalized response stored in PostgreSQL
          |
          v
Answer-processing pipeline
          |
          +---- Brand mentions
          |
          +---- Competitor mentions
          |
          +---- Citation extraction
          |
          +---- Sentiment / perception
          |
          v
Analytics calculations
          |
          v
Dashboard and recommendations
```

### 12.1 Provider adapters

We should create interfaces to isolate provider-specific logic.

For example:

```typescript
interface AIProviderAdapter {
  execute(
    request: MonitoringRequest
  ): Promise<ProviderResponse>;

  health(): Promise<boolean>;
}
```

The actual contract must also account for normalization, provider capabilities, cost, collection method, model metadata, and error handling, as required by M17.

Separate implementations will be required for OpenAI, Gemini, and licensed AI-surface providers.

### 12.2 Background processing rules

Workers must support:

- Retries and backoff.
- Idempotency.
- Provider rate limiting.
- Tenant quotas.
- Concurrency control.
- Cost tracking.
- Failure logging.
- Job status.
- Replay controls.
- Safe recovery after worker restarts.

These requirements are not implemented merely by installing BullMQ.

---

## 13. Local Development Setup for Teammates

### Prerequisites

Install:

- Git.
- Node.js and npm.
- Docker Desktop.
- VS Code or another TypeScript editor.

The team should agree on and pin one Node.js major version. Node 24.x was suggested in the configuration pack, but it should be validated with the actual build first.

### Step 1 — Clone the repository

```bash
git clone <repository-url>
```

Open the backend directory:

```bash
cd Savoir/server
```

### Step 2 — Install dependencies

```bash
npm ci
```

Do not independently install every dependency if `package.json` and `package-lock.json` are already committed.

### Step 3 — Configure environment variables

On Windows CMD:

```cmd
copy .env.example .env
```

Then fill in the documented local development values.

The `.env.example` file must be committed before this onboarding step will work.

### Step 4 — Start infrastructure

```bash
docker compose up -d postgres redis minio
```

### Step 5 — Check Docker

```bash
docker compose ps
```

### Step 6 — Apply database migrations

```bash
npx drizzle-kit migrate --config=drizzle.config.ts
```

### Step 7 — Start backend

```bash
npm run dev
```

This assumes the `dev` script exists in `package.json`.

### Step 8 — Verify API

If the health route has been implemented and registered:

```text
http://localhost:8000/api/v1/health
```

### Step 9 — Verify TypeScript

```bash
npx tsc --noEmit
```

### Step 10 — Verify build

```bash
npm run build
```

The build script must exist, and the compiled entry point must match the TypeScript configuration.

Every teammate should complete these steps successfully before starting assigned feature work.

---

## 14. Suggested npm Scripts

These are recommended scripts for the team.

Merge them with the existing `package.json`; do not overwrite current scripts.

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",

    "db:generate": "drizzle-kit generate --config=drizzle.config.ts",
    "db:migrate": "drizzle-kit migrate --config=drizzle.config.ts",
    "db:check": "drizzle-kit check --config=drizzle.config.ts",
    "db:studio": "drizzle-kit studio --config=drizzle.config.ts",

    "infra:up": "docker compose up -d postgres redis minio",
    "infra:down": "docker compose down",

    "setup:doctor": "tsx setup/scripts/doctor.ts",
    "setup:queue": "tsx setup/scripts/queue-smoke.ts",
    "setup:bucket": "tsx setup/scripts/create-local-bucket.ts"
  }
}
```

`start` assumes the compiled backend entry point is `dist/index.js`. Verify that assumption against `tsconfig.json`.

The `setup:*` scripts require the optional team configuration pack to be merged and configured.

---

## 15. Testing and Code Quality

Before sharing work across teammates, we need to standardize testing, linting, and formatting.

### 15.1 Recommended tools

- TypeScript compiler for static type checking.
- ESLint for detecting problematic code patterns.
- Prettier for consistent formatting.
- Vitest for automated tests.
- Supertest for Express HTTP integration tests.

These tools are recommended; their active configuration is not yet verified.

### 15.2 Important tests

| Area | Test cases |
|---|---|
| Authentication | Valid/invalid login, password handling, refresh/logout |
| Authorization | Role permission checks |
| Multi-tenancy | Cross-tenant access must fail |
| Validation | Invalid input must be rejected |
| Database | Migrations and constraints |
| Background jobs | Execution, retries, deduplication |
| Object storage | Upload, retrieval, access restrictions |
| AI providers | Mocked successful and failed responses |
| Analytics | Metric calculation correctness |
| Billing | Cost limits and no duplicate charging |
| Public Grader | CAPTCHA, rate limits, cost ceilings |

### 15.3 CI/CD

The configuration pack includes a GitHub Actions workflow template.

It should be reviewed and placed at:

```text
Savoir/.github/workflows/backend-ci.yml
```

The initial pipeline should check:

1. Dependency installation.
2. TypeScript compilation.
3. Backend build.
4. Unit tests.
5. Integration tests as infrastructure becomes available.

The pipeline must actually pass before we declare CI configured.

---

## 16. Development Collaboration Rules

To avoid conflicts, all developers should follow shared engineering conventions.

### Git branches

Examples:

```text
main

chore/backend-config
feat/authentication
feat/tenant-management
feat/ai-monitoring
feat/citation-intelligence
fix/database-connection
```

### Pull request rules

Every PR should include:

- Purpose of the change.
- Relevant SRS requirement IDs.
- Files and endpoints affected.
- Database changes, if any.
- Environment or dependency changes.
- Test results.
- Known limitations.

### Database changes

Database changes must be coordinated.

Do not:

- Edit previously applied migrations.
- Remove another developer's schema without approval.
- Push unreviewed destructive changes.
- Maintain different migration histories on different machines.

### Dependencies

When a dependency changes, commit:

```text
package.json
package-lock.json
```

Other developers should run:

```bash
npm ci
```

after pulling the change.

### Secrets

Never commit:

- `.env`.
- Private API keys.
- Database passwords.
- Access or refresh tokens.
- OAuth client secrets.
- Stripe secrets.
- Production credentials.

---

## 17. Suggested Work Distribution

The SRS plans for a small founding engineering team. A possible division of initial responsibilities is:

| Developer | Primary area | First responsibilities |
|---|---|---|
| Developer 1 | Platform foundation | Auth, tenants, memberships, projects, RBAC, RLS |
| Developer 2 | AI infrastructure | Provider adapters, monitoring, BullMQ, object storage, cost metering |
| Developer 3 | Intelligence and analytics | Prompts, answers, citations, competitor analysis, technical audits |

This assignment is a proposal. Final owners should be recorded in the issue tracker.

Shared API types, migration contracts, authentication rules, and event names must be agreed upon before parallel feature development.

---

## 18. Known Issues

### 18.1 npm security audit

The latest audit reported:

```text
4 moderate severity vulnerabilities
```

The vulnerabilities originate from this development dependency chain:

```text
drizzle-kit
  |
  v
@esbuild-kit/esm-loader
  |
  v
@esbuild-kit/core-utils
  |
  v
esbuild
```

The reported advisory is:

```text
GHSA-67mh-4wv8-2f99
```

npm suggested:

```bash
npm audit fix --force
```

We decided to postpone this fix to avoid introducing an untested, potentially breaking Drizzle Kit version.

**Status:** Deferred, not resolved.

Before release, review the audit again, confirm whether production dependencies are affected, apply a compatible fix, and rerun regression tests.

### 18.2 npm extraction warnings

During package installation, npm reported missing files under `@smithy/core`.

The installation completed, but AWS SDK integrity and backend build checks should be verified.

### 18.3 npm registry DNS issue

A temporary DNS error prevented an earlier audit request.

A subsequent HTTP request succeeded, and the audit was eventually completed.

### 18.4 Object storage image

The original MinIO image pull returned an authorization error.

The Docker configuration was changed to an S3-compatible Silo image while retaining the Compose service name `minio`.

The team should use the committed Compose configuration and avoid arbitrary image changes.

---

## 19. Remaining Configuration Checklist

### Environment and infrastructure

- [x] Express.js/TypeScript initial project structure.
- [x] Docker Compose infrastructure started.
- [x] PostgreSQL container running.
- [x] Redis container running.
- [x] S3-compatible storage container running.
- [x] Drizzle migration workflow verified.
- [x] First `users` table created.
- [ ] Verify Node.js version and pin team runtime.
- [ ] Finalize `.env.example`.
- [ ] Verify `.gitignore`.
- [ ] Confirm clean `npm ci`.
- [ ] Confirm TypeScript compilation.
- [ ] Confirm backend build.
- [ ] Verify health endpoint.
- [ ] Verify Redis from the application.
- [ ] Verify BullMQ worker execution.
- [ ] Verify S3 bucket read/write.
- [ ] Configure linting and formatting.
- [ ] Configure automated tests.
- [ ] Enable and test GitHub Actions.

### Database and security

- [ ] Create tenant-related tables.
- [ ] Create restricted application database role.
- [ ] Implement PostgreSQL RLS.
- [ ] Test cross-tenant isolation.
- [ ] Implement authentication.
- [ ] Define RBAC permissions.
- [ ] Implement secure token/session management.
- [ ] Implement rate limits and structured auditing.

### Future production infrastructure

- [ ] Managed PostgreSQL, Redis, and object storage.
- [ ] HTTPS and domain configuration.
- [ ] Managed secrets.
- [ ] Backups and disaster recovery.
- [ ] Logging, tracing, and metrics.
- [ ] AI-provider budget controls.
- [ ] Production CI/CD deployment.
- [ ] Privacy, legal, and security reviews.
- [ ] Load testing and release acceptance checks.

---

## 20. Implementation Roadmap

Once shared configuration is verified, we should implement features in a dependency-aware order.

**Phase 1 — Platform foundation**

Complete authentication, tenants, memberships, RBAC, RLS, project CRUD, testing, and common APIs.

**Phase 2 — Data collection infrastructure**

Implement provider adapters, monitoring schedules, BullMQ workers, raw evidence storage, normalized run records, and cost controls.

**Phase 3 — AEO/GEO intelligence**

Implement prompts, AI Answer Explorer, citation extraction, visibility metrics, competitor analysis, and technical audits.

**Phase 4 — User-facing optimization**

Implement dashboards, recommendations, reporting, project insights, and Google integrations.

**Phase 5 — AI Search Grader and launch preparation**

Implement the no-login public Grader with strict abuse controls, reports, account conversion, usage limits, billing, and compliance requirements.

This roadmap is a proposed engineering order, not a replacement for the SRS release plan.

---

## 21. Important Engineering Rules

Every developer should follow these principles:

1. **Read the SRS before implementing a module.** Each feature must trace back to its requirements.
2. **Keep controllers thin.** Place business logic in services.
3. **Validate all external input.** Use shared Zod schemas.
4. **Enforce tenant isolation.** Never trust tenant IDs supplied by clients without authorization.
5. **Use committed migrations.** Do not manually change shared database schemas.
6. **Never expose secrets.** Provider credentials belong on the backend.
7. **Design background work for retries.** Jobs must be idempotent where required.
8. **Retain original evidence.** AI monitoring results must be auditable.
9. **Make metrics explainable.** Store calculation methods, samples, and source types.
10. **Track provider costs.** No uncontrolled AI API execution.
11. **Write tests.** Especially for tenant isolation, authentication, billing, and monitoring.
12. **Keep documentation updated.** Configuration and API changes must be reflected in the repository.

---

## 22. Final Notes for Teammates

We have established the initial backend structure and successfully configured Docker-based infrastructure and the Drizzle/PostgreSQL migration workflow.

However, the backend is **not yet fully configured or ready for independent feature development without additional shared setup work**.

The highest-priority remaining foundation tasks are:

1. Verify clean installation and build.
2. Finalize shared environment configuration.
3. Complete tenant-related database models.
4. Establish restricted database access and RLS.
5. Verify Redis, BullMQ, and S3 integrations.
6. Configure automated tests and GitHub Actions.
7. Verify the setup on every teammate's machine.

Once those checks pass, the team can begin parallel feature development on a consistent, secure foundation.

**The SRS remains the authoritative reference for product functionality. This README documents how we are preparing to implement it.**
