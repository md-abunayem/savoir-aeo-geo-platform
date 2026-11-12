import {
  pgTable,
  pgEnum,
  primaryKey,
  uuid,
  varchar,
  text,
  timestamp,
  uniqueIndex,
  index,
  integer,
  jsonb,
  boolean,
  numeric,
  date,
  vector,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Global identity records; tenant-owned records are below.
export const monitoringScheduleRequests = pgTable(
  "monitoring_schedule_requests",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    input: jsonb("input").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId, table.requestKey] })],
);

export const monitoringPromptRequests = pgTable(
  "monitoring_prompt_requests",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    input: jsonb("input").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId, table.requestKey] })],
);

export const monitoringConnectionTests = pgTable(
  "monitoring_connection_tests",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    requestKey: text("request_key").notNull(),
    engine: text("engine").notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.requestKey] })],
);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),

  name: varchar("name", { length: 150 }).notNull(),

  email: varchar("email", { length: 255 }).notNull().unique(),

  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  passwordHash: varchar("password_hash", {
    length: 255,
  }),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

// 2. Role and project enums
export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "analyst", "viewer"]);

export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "active",
  "archived",
  "paused",
]);

// 3. Tenants
export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),

  name: varchar("name", { length: 200 }).notNull(),

  region: varchar("region", { length: 20 }).default("us").notNull(),

  status: varchar("status", { length: 24 }).default("active").notNull(), // active, paused, archived

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

// 4. Memberships
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),

    role: memberRoleEnum("role").default("viewer").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("membership_tenant_user_unique").on(table.tenantId, table.userId),
    index("membership_user_idx").on(table.userId),
  ],
);

// 5. Projects
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),

    brandName: varchar("brand_name", {
      length: 200,
    }).notNull(),

    domain: text("domain").notNull(),

    description: text("description"),

    aliases: jsonb("aliases").default([]).notNull(),

    defaultMarkets: jsonb("default_markets")
      .default([{ country: "US", language: "en" }])
      .notNull(),

    status: projectStatusEnum("status").default("draft").notNull(),

    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("project_tenant_domain_unique").on(table.tenantId, table.domain)],
);

// 6. OAuth Accounts
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 30 }).notNull(),
    providerUserId: varchar("provider_user_id", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_uid_unique").on(table.provider, table.providerUserId),
    index("oauth_accounts_user_idx").on(table.userId),
  ],
);

// 7. Onboarding Drafts
export const onboardingDrafts = pgTable("onboarding_drafts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  step: integer("step").default(1).notNull(),
  data: jsonb("data").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 8. Competitors
export const competitors = pgTable(
  "competitors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 150 }).notNull(),
    domain: text("domain").notNull(),
    aliases: jsonb("aliases").default([]).notNull(),
    rationale: text("rationale"),
    discoveredVia: varchar("discovered_via", { length: 50 }).default("manual").notNull(),
    competitorType: varchar("competitor_type", { length: 30 }).default("direct").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("competitors_project_idx").on(table.projectId)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    familyId: uuid("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("auth_sessions_family_idx").on(table.familyId),
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const authEvents = pgTable("auth_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  event: varchar("event", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailStatusEnum = pgEnum("email_status", [
  "pending",
  "processing",
  "accepted",
  "failed",
  "uncertain",
]);
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    encryptedPayload: text("encrypted_payload"),
    status: emailStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    leaseId: uuid("lease_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    providerMessageId: text("provider_message_id"),
    errorCode: varchar("error_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("email_outbox_due_idx").on(table.status, table.availableAt)],
);

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Monitoring configuration is versioned in each immutable run request.
export const monitoringPrompts = pgTable("monitoring_prompts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  body: text("body").notNull(),
  persona: text("persona").notNull().default(""),
  tags: text("tags").array().notNull().default([]),
  version: integer("version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedActive: boolean("archived_active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const monitoringPromptVersions = pgTable(
  "monitoring_prompt_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => monitoringPrompts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    persona: text("persona").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("monitoring_prompt_versions_unique").on(table.promptId, table.version),
    index("monitoring_prompt_versions_project_idx").on(
      table.projectId,
      table.promptId,
      table.version,
    ),
  ],
);
export const monitoringSchedules = pgTable("monitoring_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  config: jsonb("config").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const monitoringCredits = pgTable("monitoring_credits", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  available: integer("available").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  used: integer("used").notNull().default(0),
  minimumIntervalMinutes: integer("minimum_interval_minutes").notNull().default(1440),
});
export const monitoringRuns = pgTable(
  "monitoring_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    batchKey: varchar("batch_key", { length: 160 }).notNull(),
    itemKey: varchar("item_key", { length: 200 }).notNull(),
    request: jsonb("request").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    leaseId: uuid("lease_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    result: jsonb("result"),
    errorCode: varchar("error_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("monitoring_run_dedupe").on(t.projectId, t.batchKey, t.itemKey),
    index("monitoring_run_due").on(t.status, t.availableAt),
  ],
);
export const monitoringEvents = pgTable("monitoring_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  projectId: uuid("project_id").references(() => projects.id),
  kind: varchar("kind", { length: 80 }).notNull(),
  details: jsonb("details").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const monitoringProviderState = pgTable("monitoring_provider_state", {
  engine: varchar("engine", { length: 40 }).primaryKey(),
  nextCallAt: timestamp("next_call_at", { withTimezone: true }).notNull().defaultNow(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  failureSince: timestamp("failure_since", { withTimezone: true }),
  callsToday: integer("calls_today").notNull().default(0),
  day: varchar("day", { length: 10 }).notNull(),
  lastModel: varchar("last_model", { length: 150 }),
});

// 9. Answer Pipeline Models (ANS & M5)
export const answers = pgTable(
  "answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => monitoringRuns.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id").references(() => monitoringPrompts.id, { onDelete: "set null" }),
    engine: varchar("engine", { length: 40 }).notNull(),
    engineModel: varchar("engine_model", { length: 150 }),
    geo: varchar("geo", { length: 10 }).default("US").notNull(),
    language: varchar("language", { length: 10 }).default("en").notNull(),
    text: text("text").notNull(),
    textRef: text("text_ref"),
    textHash: varchar("text_hash", { length: 64 }).notNull(),
    parserVersion: varchar("parser_version", { length: 50 }).default("v1.0.0").notNull(),
    hasCitations: boolean("has_citations").default(false).notNull(),
    refusalFlag: boolean("refusal_flag").default(false).notNull(),
    sourceType: varchar("source_type", { length: 30 }).default("official_api").notNull(),
    searchQueries: jsonb("search_queries").default([]).notNull(),
    latencyMs: integer("latency_ms"),
    tokensUsed: integer("tokens_used"),
    rawResponse: jsonb("raw_response"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("answers_run_unique").on(table.runId),
    index("answers_project_created_idx").on(table.projectId, table.createdAt),
    index("answers_tenant_project_idx").on(table.tenantId, table.projectId),
    index("answers_prompt_idx").on(table.promptId),
    index("answers_engine_idx").on(table.projectId, table.engine),
  ],
);

export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 20 }).notNull(),
    entityId: uuid("entity_id"),
    entityName: varchar("entity_name", { length: 200 }).notNull(),
    matchedText: varchar("matched_text", { length: 200 }).notNull(),
    positionIndex: integer("position_index").notNull(),
    listRank: integer("list_rank"),
    sentiment: integer("sentiment").default(0).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).default("1.000").notNull(),
    snippet: text("snippet").notNull(),
    reviewStatus: varchar("review_status", { length: 20 }).default("auto").notNull(),
    label: varchar("label", { length: 20 }).default("Observed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("mentions_answer_idx").on(table.answerId),
    index("mentions_project_entity_idx").on(table.projectId, table.entityName),
    index("mentions_project_sentiment_idx").on(table.projectId, table.sentiment),
  ],
);

export const citations = pgTable(
  "citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    sourceType: varchar("source_type", { length: 50 }).default("other").notNull(),
    anchorText: text("anchor_text"),
    orderIndex: integer("order_index").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("citations_answer_idx").on(table.answerId),
    index("citations_project_domain_idx").on(table.projectId, table.domain),
    index("citations_project_source_type_idx").on(table.projectId, table.sourceType),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    entityName: varchar("entity_name", { length: 200 }).notNull(),
    claimText: text("claim_text").notNull(),
    theme: varchar("theme", { length: 50 }).notNull(),
    sentiment: integer("sentiment").default(0).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).default("0.800").notNull(),
    label: varchar("label", { length: 20 }).default("Estimated").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("claims_answer_idx").on(table.answerId),
    index("claims_project_theme_idx").on(table.projectId, table.theme),
  ],
);

export const answerFlags = pgTable(
  "answer_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 80 }).notNull(),
    note: text("note"),
    tags: jsonb("tags").default([]).notNull(),
    status: varchar("status", { length: 20 }).default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("answer_flags_answer_idx").on(table.answerId),
    index("answer_flags_project_status_idx").on(table.projectId, table.status),
  ],
);

// 10. AI Visibility Analytics Models (VIS & M3)
export const metricFacts = pgTable(
  "metric_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    engine: varchar("engine", { length: 40 }).default("all").notNull(),
    market: varchar("market", { length: 20 }).default("all").notNull(),
    entityId: uuid("entity_id"),
    entityType: varchar("entity_type", { length: 20 }).default("brand").notNull(),
    metricName: varchar("metric_name", { length: 50 }).notNull(),
    value: numeric("value", { precision: 8, scale: 4 }).notNull(),
    n: integer("n").default(0).notNull(),
    ciLow: numeric("ci_low", { precision: 8, scale: 4 }),
    ciHigh: numeric("ci_high", { precision: 8, scale: 4 }),
    label: varchar("label", { length: 20 }).default("Observed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("metric_facts_unique_idx").on(
      table.projectId,
      table.date,
      table.engine,
      table.market,
      table.entityId,
      table.metricName,
    ),
    index("metric_facts_project_date_idx").on(table.projectId, table.date),
    index("metric_facts_tenant_project_idx").on(table.tenantId, table.projectId),
  ],
);

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 150 }).notNull(),
    filters: jsonb("filters").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("saved_views_project_idx").on(table.projectId)],
);

export const metricGoals = pgTable(
  "metric_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    metricName: varchar("metric_name", { length: 50 }).notNull(),
    targetValue: numeric("target_value", { precision: 8, scale: 4 }).notNull(),
    deadline: date("deadline"),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("metric_goals_project_idx").on(table.projectId, table.status)],
);

// 11. Citation Intelligence Models (CIT & M6)
export const sourceDomains = pgTable(
  "source_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 255 }).notNull(),
    sourceType: varchar("source_type", { length: 50 }).default("other").notNull(),
    isAllowed: boolean("is_allowed").default(true).notNull(),
    isDenied: boolean("is_denied").default(false).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_domains_project_domain_unique").on(table.projectId, table.domain),
    index("source_domains_tenant_project_idx").on(table.tenantId, table.projectId),
  ],
);

export const brokenCitations = pgTable(
  "broken_citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    citationId: uuid("citation_id").references(() => citations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    statusCode: integer("status_code").notNull(),
    redirectUrl: text("redirect_url"),
    errorMessage: text("error_message"),
    taskStatus: varchar("task_status", { length: 20 }).default("open").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("broken_citations_project_status_idx").on(table.projectId, table.taskStatus),
    index("broken_citations_tenant_project_idx").on(table.tenantId, table.projectId),
  ],
);

export const citationOpportunities = pgTable(
  "citation_opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 255 }).notNull(),
    pageUrl: text("page_url"),
    sourceType: varchar("source_type", { length: 50 }).default("other").notNull(),
    gapRunsCount: integer("gap_runs_count").default(0).notNull(),
    opportunityScore: numeric("opportunity_score", { precision: 6, scale: 2 })
      .default("0.00")
      .notNull(),
    competitorNames: jsonb("competitor_names").default([]).notNull(),
    promptIds: jsonb("prompt_ids").default([]).notNull(),
    suggestedAction: text("suggested_action").notNull(),
    status: varchar("status", { length: 20 }).default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("citation_opportunities_project_score_idx").on(table.projectId, table.opportunityScore),
    index("citation_opportunities_tenant_project_idx").on(table.tenantId, table.projectId),
  ],
);

// 12. Competitor Intelligence Models (CMP & M7)
export const competitorCandidates = pgTable(
  "competitor_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 150 }).notNull(),
    domain: text("domain"),
    mentionCount: integer("mention_count").default(0).notNull(),
    mentionFrequency: numeric("mention_frequency", { precision: 5, scale: 4 })
      .default("0.0000")
      .notNull(),
    coOccurrenceCount: integer("co_occurrence_count").default(0).notNull(),
    engines: jsonb("engines").default([]).notNull(),
    sampleAnswerIds: jsonb("sample_answer_ids").default([]).notNull(),
    entityType: varchar("entity_type", { length: 50 }).default("competitor").notNull(),
    status: varchar("status", { length: 30 }).default("suggested").notNull(),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("competitor_candidates_project_name_idx").on(table.projectId, table.name),
    index("competitor_candidates_project_status_idx").on(table.projectId, table.status),
  ],
);

export const competitiveGaps = pgTable(
  "competitive_gaps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => monitoringPrompts.id, { onDelete: "cascade" }),
    engine: varchar("engine", { length: 40 }).default("all").notNull(),
    competitorVis: numeric("competitor_vis", { precision: 5, scale: 4 })
      .default("0.0000")
      .notNull(),
    brandVis: numeric("brand_vis", { precision: 5, scale: 4 }).default("0.0000").notNull(),
    gapScore: numeric("gap_score", { precision: 6, scale: 2 }).default("0.00").notNull(),
    promptWeight: numeric("prompt_weight", { precision: 5, scale: 4 }).default("1.0000").notNull(),
    demandIndex: integer("demand_index").default(50).notNull(),
    priority: integer("priority").default(1).notNull(),
    reasons: jsonb("reasons").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("competitive_gaps_unique_idx").on(
      table.projectId,
      table.competitorId,
      table.promptId,
      table.engine,
    ),
    index("competitive_gaps_project_score_idx").on(table.projectId, table.gapScore),
  ],
);

// 19. Public AI Search Grader Reports (HG-01 to HG-24, HG-FR-001 to HG-FR-006)
export const graderReports = pgTable(
  "grader_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shareToken: varchar("share_token", { length: 64 }).notNull().unique(),
    brandName: varchar("brand_name", { length: 150 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    normalizedDomain: varchar("normalized_domain", { length: 255 }).notNull(),
    category: varchar("category", { length: 100 }).default("General").notNull(),
    country: varchar("country", { length: 10 }).default("US").notNull(),
    language: varchar("language", { length: 10 }).default("en").notNull(),
    competitors: jsonb("competitors").default([]).notNull(),
    status: varchar("status", { length: 30 }).default("pending").notNull(),
    progress: integer("progress").default(0).notNull(),
    currentStage: varchar("current_stage", { length: 100 }).default("Initialized").notNull(),
    score: integer("score").default(0).notNull(),
    grade: varchar("grade", { length: 5 }).default("C").notNull(),
    metrics: jsonb("metrics").default({}).notNull(),
    prompts: jsonb("prompts").default([]).notNull(),
    brandPerception: jsonb("brand_perception").default({}).notNull(),
    technicalAudit: jsonb("technical_audit").default({}).notNull(),
    recommendations: jsonb("recommendations").default([]).notNull(),
    costUsd: numeric("cost_usd", { precision: 6, scale: 4 }).default("0.0000").notNull(),
    ipHash: varchar("ip_hash", { length: 64 }).notNull(),
    deviceHash: varchar("device_hash", { length: 64 }),
    email: varchar("email", { length: 255 }),
    emailOptIn: boolean("email_opt_in").default(false).notNull(),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    convertedTenantId: uuid("converted_tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    convertedProjectId: uuid("converted_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("grader_reports_share_token_idx").on(table.shareToken),
    index("grader_reports_cache_idx").on(
      table.normalizedDomain,
      table.brandName,
      table.country,
      table.createdAt,
    ),
    index("grader_reports_ip_created_idx").on(table.ipHash, table.createdAt),
    index("grader_reports_domain_created_idx").on(table.normalizedDomain, table.createdAt),
    index("grader_reports_expires_at_idx").on(table.expiresAt),
  ],
);

// 20. Technical AEO Audits (M8 / TEC-FR-001 to TEC-FR-016)
export const technicalAudits = pgTable(
  "technical_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    status: varchar("status", { length: 30 }).default("pending").notNull(),
    crawlType: varchar("crawl_type", { length: 30 }).default("full_site").notNull(),
    targetDomain: varchar("target_domain", { length: 255 }).notNull(),
    pagesCrawled: integer("pages_crawled").default(0).notNull(),
    pagesLimit: integer("pages_limit").default(500).notNull(),
    attemptedUrls: integer("attempted_urls"),
    fetchedPages: integer("fetched_pages"),
    failedRequests: integer("failed_requests"),
    httpErrorPages: integer("http_error_pages"),
    excludedPages: integer("excluded_pages"),
    pagesScored: integer("pages_scored"),
    queuedUrlsRemaining: integer("queued_urls_remaining"),
    scoringVersion: integer("scoring_version").default(3).notNull(),
    completionReason: text("completion_reason"),
    siteWideChecks: jsonb("site_wide_checks").default({}).notNull(),
    overallScore: integer("overall_score").default(0).notNull(),
    grade: varchar("grade", { length: 5 }).default("C").notNull(),
    categoryScores: jsonb("category_scores")
      .default({
        botAccess: null,
        indexability: null,
        schema: null,
        answerStructure: null,
        performanceTrust: null,
        agentReadability: null,
      })
      .notNull(),
    botMatrix: jsonb("bot_matrix").default({}).notNull(),
    issuesSummary: jsonb("issues_summary")
      .default({
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        total: 0,
      })
      .notNull(),
    durationMs: integer("duration_ms").default(0).notNull(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("technical_audits_project_created_idx").on(table.projectId, table.createdAt),
    index("technical_audits_tenant_idx").on(table.tenantId),
    index("technical_audits_status_idx").on(table.status),
  ],
);

export const technicalAuditPages = pgTable(
  "technical_audit_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .references(() => technicalAudits.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    crawlSource: varchar("crawl_source", { length: 20 }),
    fallbackReason: text("fallback_reason"),
    duplicateOf: text("duplicate_of"),
    path: varchar("path", { length: 1024 }).notNull(),
    statusCode: integer("status_code").default(200).notNull(),
    fetchError: text("fetch_error"),
    crawlStatus: varchar("crawl_status", { length: 20 }).default("fetched").notNull(),
    excluded: boolean("excluded").default(false).notNull(),
    exclusionReason: text("exclusion_reason"),
    isIndexable: boolean("is_indexable").default(true).notNull(),
    canonicalUrl: text("canonical_url"),
    canonicalStatus: varchar("canonical_status", { length: 50 }).default("match").notNull(),
    pageScore: integer("page_score"),
    wordCount: integer("word_count").default(0).notNull(),
    headingCounts: jsonb("heading_counts").default({ h1: 0, h2: 0, h3: 0, h4: 0 }).notNull(),
    answerFirstDetected: boolean("answer_first_detected").default(false).notNull(),
    faqBlocksDetected: boolean("faq_blocks_detected").default(false).notNull(),
    schemasDetected: jsonb("schemas_detected").default([]).notNull(),
    hasJsDomDiff: boolean("has_js_dom_diff").default(false).notNull(),
    domDiffMetrics: jsonb("dom_diff_metrics").default({}).notNull(),
    loadTimeMs: integer("load_time_ms").default(0).notNull(),
    issuesCount: integer("issues_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("technical_audit_pages_audit_idx").on(table.auditId),
    index("technical_audit_pages_project_url_idx").on(table.projectId, table.url),
    index("technical_audit_pages_score_idx").on(table.auditId, table.pageScore),
  ],
);

export const technicalAuditIssues = pgTable(
  "technical_audit_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .references(() => technicalAudits.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    pageId: uuid("page_id").references(() => technicalAuditPages.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 50 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull(),
    code: varchar("code", { length: 100 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    recommendation: text("recommendation").notNull(),
    fixSnippet: text("fix_snippet"),
    affectedUrl: text("affected_url"),
    status: varchar("status", { length: 20 }).default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("technical_audit_issues_audit_sev_idx").on(table.auditId, table.severity),
    index("technical_audit_issues_audit_cat_idx").on(table.auditId, table.category),
    index("technical_audit_issues_project_idx").on(table.projectId),
    index("technical_audit_issues_page_idx").on(table.pageId),
  ],
);

export const technicalAuditSchedules = pgTable(
  "technical_audit_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    frequency: varchar("frequency", { length: 20 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("technical_audit_schedules_project_unique").on(table.projectId),
    index("technical_audit_schedules_due_idx").on(table.isActive, table.nextRunAt),
  ],
);

// 21. Agent Experience Optimization Policies (M16 / AXO-FR-001 to AXO-FR-010)
export const agentPolicies = pgTable(
  "agent_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    policyPreset: varchar("policy_preset", { length: 50 }).default("search_only").notNull(),
    robotsTxtContent: text("robots_txt_content").notNull(),
    botRules: jsonb("bot_rules").default({}).notNull(),
    trainingBotsDisallowed: boolean("training_bots_disallowed").default(true).notNull(),
    searchBotsAllowed: boolean("search_bots_allowed").default(true).notNull(),
    customDirectives: text("custom_directives"),
    llmsTxtDraft: text("llms_txt_draft"),
    llmsFullTxtDraft: text("llms_full_txt_draft"),
    llmsValidation: jsonb("llms_validation").default({}).notNull(),
    schemaTemplates: jsonb("schema_templates").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_policies_project_idx").on(table.projectId),
    index("agent_policies_tenant_idx").on(table.tenantId),
  ],
);

// 22. Content Intelligence Inventory & Scoring (M9 / CNT-FR-001 to CNT-FR-009)
export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    path: varchar("path", { length: 1024 }).notNull(),
    title: varchar("title", { length: 500 }),
    metaDescription: text("meta_description"),
    wordCount: integer("word_count").default(0).notNull(),
    contentScore: integer("content_score").default(0).notNull(), // 0 - 100
    answerFirstScore: integer("answer_first_score").default(0).notNull(),
    entityClarityScore: integer("entity_clarity_score").default(0).notNull(),
    schemaScore: integer("schema_score").default(0).notNull(),
    structureScore: integer("structure_score").default(0).notNull(),
    credibilityScore: integer("credibility_score").default(0).notNull(),
    mappedPromptIds: jsonb("mapped_prompt_ids").default([]).notNull(),
    promptClusters: jsonb("prompt_clusters").default([]).notNull(),
    lastModified: timestamp("last_modified", { withTimezone: true }),
    isStale: boolean("is_stale").default(false).notNull(),
    cannibalizedPromptIds: jsonb("cannibalized_prompt_ids").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("content_items_project_idx").on(table.projectId),
    index("content_items_tenant_idx").on(table.tenantId),
    index("content_items_score_idx").on(table.projectId, table.contentScore),
    uniqueIndex("content_items_project_url_idx").on(table.projectId, table.url),
  ],
);

// 23. Content Gaps (M9 / CNT-FR-002)
export const contentGaps = pgTable(
  "content_gaps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    promptId: uuid("prompt_id")
      .references(() => monitoringPrompts.id, { onDelete: "cascade" })
      .notNull(),
    promptText: text("prompt_text").notNull(),
    clusterName: varchar("cluster_name", { length: 200 }).default("General").notNull(),
    brandVisScore: numeric("brand_vis_score", { precision: 5, scale: 4 })
      .default("0.0000")
      .notNull(),
    demandIndex: integer("demand_index").default(50).notNull(),
    priorityScore: numeric("priority_score", { precision: 5, scale: 2 }).default("0.00").notNull(),
    closestOwnedPageUrl: text("closest_owned_page_url"),
    similarityScore: numeric("similarity_score", { precision: 5, scale: 4 })
      .default("0.0000")
      .notNull(),
    topCitedCompetitorDomains: jsonb("top_cited_competitor_domains").default([]).notNull(),
    suggestedAction: text("suggested_action").notNull(),
    status: varchar("status", { length: 50 }).default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("content_gaps_project_idx").on(table.projectId),
    index("content_gaps_tenant_idx").on(table.tenantId),
    index("content_gaps_priority_idx").on(table.projectId, table.priorityScore),
    index("content_gaps_status_idx").on(table.projectId, table.status),
  ],
);

// 24. Content Briefs (M9 / CNT-FR-005, CNT-FR-008, CNT-FR-009)
export const contentBriefs = pgTable(
  "content_briefs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    gapId: uuid("gap_id").references(() => contentGaps.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    targetPrompts: jsonb("target_prompts").default([]).notNull(),
    primaryIntent: varchar("primary_intent", { length: 100 }).default("informational").notNull(),
    questionsToAnswer: jsonb("questions_to_answer").default([]).notNull(),
    suggestedOutline: jsonb("suggested_outline").default([]).notNull(),
    targetEntities: jsonb("target_entities").default([]).notNull(),
    factsAndStatistics: jsonb("facts_and_statistics").default([]).notNull(),
    recommendedSchemas: jsonb("recommended_schemas").default([]).notNull(),
    internalLinkingSuggestions: jsonb("internal_linking_suggestions").default([]).notNull(),
    sourcesToCite: jsonb("sources_to_cite").default([]).notNull(),
    markdownContent: text("markdown_content").notNull(),
    status: varchar("status", { length: 50 }).default("draft").notNull(),
    label: varchar("label", { length: 50 }).default("Estimated").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("content_briefs_project_idx").on(table.projectId),
    index("content_briefs_tenant_idx").on(table.tenantId),
    index("content_briefs_created_idx").on(table.projectId, table.createdAt),
  ],
);

// 25. Action Items (M10 / ACT-FR-001 to ACT-FR-008)
export const actionItems = pgTable(
  "action_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 64 }).notNull(), // technical, content, citation, agent_readiness, accuracy, competitor
    sourceModule: varchar("source_module", { length: 32 }).notNull(), // M5, M6, M7, M8, M9, M16, manual
    sourceId: varchar("source_id", { length: 255 }),
    dedupKey: varchar("dedup_key", { length: 255 }).notNull(),
    status: varchar("status", { length: 32 }).default("todo").notNull(), // backlog, todo, in_progress, done, dismissed
    dismissReason: text("dismiss_reason"),
    priorityScore: numeric("priority_score", { precision: 5, scale: 2 }).default("50.00").notNull(),
    impact: integer("impact").default(5).notNull(), // 1-10
    confidence: numeric("confidence", { precision: 3, scale: 2 }).default("0.80").notNull(), // 0.00-1.00
    effort: varchar("effort", { length: 8 }).default("M").notNull(), // S, M, L
    owner: varchar("owner", { length: 255 }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    evidence: jsonb("evidence").default([]).notNull(),
    fixGuidance: jsonb("fix_guidance"), // { type, code, instructions, label: "Estimated" }
    verificationStatus: varchar("verification_status", { length: 32 }).default("pending").notNull(), // pending, verified, not_verified, inconclusive
    verificationNotes: text("verification_notes"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("action_items_project_idx").on(table.projectId),
    index("action_items_tenant_idx").on(table.tenantId),
    index("action_items_status_idx").on(table.projectId, table.status),
    index("action_items_priority_idx").on(table.projectId, table.priorityScore),
    index("action_items_category_idx").on(table.projectId, table.category),
    index("action_items_dedup_idx").on(table.projectId, table.dedupKey),
  ],
);

// 26. Action Comments (M10 / ACT-FR-002, ACT-FR-006)
export const actionComments = pgTable(
  "action_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actionId: uuid("action_id")
      .references(() => actionItems.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: varchar("user_name", { length: 255 }).default("Team Member").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("action_comments_action_idx").on(table.actionId),
    index("action_comments_tenant_idx").on(table.tenantId),
  ],
);

// 27. Integration Connections (M14 / ITG-FR-001, ITG-FR-002, ITG-FR-010, ITG-FR-011)
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar("provider", { length: 50 }).notNull(), // google_search_console, google_analytics_4, slack, hubspot
    status: varchar("status", { length: 50 }).default("connected").notNull(), // connected, paused, error, disconnected
    accountEmail: varchar("account_email", { length: 255 }),
    propertyId: varchar("property_id", { length: 255 }),
    propertyName: varchar("property_name", { length: 255 }),
    scopesGranted: jsonb("scopes_granted").default([]).notNull(),
    encryptedTokens: text("encrypted_tokens"), // AES-256-GCM encrypted tokens
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncStatus: varchar("last_sync_status", { length: 50 }).default("pending").notNull(),
    lastSyncError: text("last_sync_error"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_conn_project_idx").on(table.projectId),
    index("integration_conn_tenant_idx").on(table.tenantId),
    index("integration_conn_provider_idx").on(table.projectId, table.provider),
  ],
);

// 28. GSC Performance Facts (M14 / ITG-FR-001, M11 / TRF-FR-004)
export const gscPerformanceFacts = pgTable(
  "gsc_performance_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    query: text("query").notNull(),
    page: text("page").notNull(),
    date: varchar("date", { length: 32 }).notNull(), // YYYY-MM-DD
    device: varchar("device", { length: 50 }).default("DESKTOP").notNull(),
    country: varchar("country", { length: 10 }).default("usa").notNull(),
    impressions: integer("impressions").default(0).notNull(),
    clicks: integer("clicks").default(0).notNull(),
    ctr: numeric("ctr", { precision: 5, scale: 4 }).default("0.0000").notNull(),
    position: numeric("position", { precision: 5, scale: 2 }).default("0.00").notNull(),
    isQuestionQuery: boolean("is_question_query").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("gsc_facts_project_idx").on(table.projectId),
    index("gsc_facts_tenant_idx").on(table.tenantId),
    index("gsc_facts_project_date_idx").on(table.projectId, table.date),
    index("gsc_facts_question_idx").on(table.projectId, table.isQuestionQuery),
  ],
);

// 29. Traffic Analytics Facts (M11 / TRF-FR-001, TRF-FR-002, TRF-FR-003)
export const trafficAnalyticsFacts = pgTable(
  "traffic_analytics_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    date: varchar("date", { length: 32 }).notNull(), // YYYY-MM-DD
    source: varchar("source", { length: 255 }).notNull(),
    medium: varchar("medium", { length: 100 }).notNull(),
    landingPage: text("landing_page").notNull(),
    isAiReferral: boolean("is_ai_referral").default(false).notNull(),
    aiEngine: varchar("ai_engine", { length: 50 }), // chatgpt, gemini, perplexity, claude, copilot, other_ai
    sessions: integer("sessions").default(0).notNull(),
    engagedSessions: integer("engaged_sessions").default(0).notNull(),
    users: integer("users").default(0).notNull(),
    conversions: integer("conversions").default(0).notNull(),
    revenue: numeric("revenue", { precision: 10, scale: 2 }).default("0.00").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("traffic_facts_project_idx").on(table.projectId),
    index("traffic_facts_tenant_idx").on(table.tenantId),
    index("traffic_facts_date_idx").on(table.projectId, table.date),
    index("traffic_facts_ai_idx").on(table.projectId, table.isAiReferral),
    index("traffic_facts_engine_idx").on(table.projectId, table.aiEngine),
  ],
);

// 30. Tenant API Keys (M14 / ITG-FR-005, ITG-FR-012)
export const tenantApiKeys = pgTable(
  "tenant_api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(), // e.g. "sk_live_abc123"
    keyHash: varchar("key_hash", { length: 128 }).notNull(), // SHA-256 hash
    scopes: jsonb("scopes").default(["read"]).notNull(),
    rateLimitRpm: integer("rate_limit_rpm").default(60).notNull(),
    rateLimitBurst: integer("rate_limit_burst").default(120).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tenant_api_keys_tenant_idx").on(table.tenantId),
    index("tenant_api_keys_project_idx").on(table.projectId),
    index("tenant_api_keys_hash_idx").on(table.keyHash),
  ],
);

// 31. Webhook Endpoints (M14 / ITG-FR-006)
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    description: varchar("description", { length: 255 }),
    secret: varchar("secret", { length: 128 }).notNull(), // HMAC-SHA256 secret
    events: jsonb("events").default([]).notNull(), // ["run.completed", "alert.created", "audit.completed", "action.verified"]
    isActive: boolean("is_active").default(true).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    lastDispatchedAt: timestamp("last_dispatched_at", { withTimezone: true }),
    lastResponseCode: integer("last_response_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("webhook_endpoints_tenant_idx").on(table.tenantId),
    index("webhook_endpoints_project_idx").on(table.projectId),
    index("webhook_endpoints_active_idx").on(table.projectId, table.isActive),
  ],
);

// 32. Report Schedules (M13 / RPT-FR-003, RPT-FR-005)
export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    frequency: varchar("frequency", { length: 32 }).notNull(), // weekly, monthly
    dayOfWeek: integer("day_of_week"), // 0-6 (0=Sunday, 1=Monday)
    dayOfMonth: integer("day_of_month"), // 1-31
    recipients: jsonb("recipients").default([]).notNull(), // ["exec@brand.com"]
    format: varchar("format", { length: 20 }).default("pdf").notNull(), // pdf, html, csv
    sections: jsonb("sections")
      .default([
        "visibility",
        "citations",
        "competitors",
        "technical",
        "content",
        "traffic",
        "actions",
      ])
      .notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastRunStatus: varchar("last_run_status", { length: 32 }), // success, failed, pending
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("report_schedules_tenant_idx").on(table.tenantId),
    index("report_schedules_project_idx").on(table.projectId),
    index("report_schedules_active_idx").on(table.projectId, table.isActive),
    index("report_schedules_next_run_idx").on(table.isActive, table.nextRunAt),
  ],
);

// 33. Generated Executive Reports (M13 / RPT-FR-004, RPT-FR-010)
export const generatedReports = pgTable(
  "generated_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    scheduleId: uuid("schedule_id").references(() => reportSchedules.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    dateWindowDays: integer("date_window_days").default(30).notNull(),
    format: varchar("format", { length: 20 }).default("pdf").notNull(),
    status: varchar("status", { length: 32 }).default("completed").notNull(), // generating, completed, failed
    summaryKpis: jsonb("summary_kpis").notNull(), // { readinessIndex, visibilityScore, aiSessions, citationCount, technicalScore }
    contentPayload: jsonb("content_payload").notNull(), // highlights, wins, incidents, topActions
    downloadUrl: text("download_url"),
    deliveredEmails: jsonb("delivered_emails").default([]).notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("generated_reports_tenant_idx").on(table.tenantId),
    index("generated_reports_project_idx").on(table.projectId),
    index("generated_reports_schedule_idx").on(table.scheduleId),
    index("generated_reports_created_idx").on(table.projectId, table.createdAt),
  ],
);

// 34. Alert Rules (M13 / RPT-FR-006, RPT-FR-007)
export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    ruleType: varchar("rule_type", { length: 64 }).notNull(), // visibility_drop, competitor_overtake, lost_citation, crawl_blockage
    threshold: jsonb("threshold").notNull(), // { dropPercent: 15, minConfidence: 0.95 }
    severity: varchar("severity", { length: 32 }).default("warning").notNull(), // critical, warning, info
    channels: jsonb("channels").default(["in_app", "email"]).notNull(),
    emailRecipients: jsonb("email_recipients").default([]).notNull(),
    cooldownHours: integer("cooldown_hours").default(24).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("alert_rules_tenant_idx").on(table.tenantId),
    index("alert_rules_project_idx").on(table.projectId),
    index("alert_rules_type_idx").on(table.projectId, table.ruleType),
    index("alert_rules_active_idx").on(table.projectId, table.isActive),
  ],
);

// 35. Alert Incidents (M13 / RPT-FR-008, RPT-FR-009)
export const alertIncidents = pgTable(
  "alert_incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    ruleId: uuid("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
    ruleType: varchar("rule_type", { length: 64 }).notNull(),
    severity: varchar("severity", { length: 32 }).default("warning").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    details: jsonb("details").default({}).notNull(),
    status: varchar("status", { length: 32 }).default("active").notNull(), // active, acknowledged, resolved, dismissed
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: varchar("acknowledged_by", { length: 255 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedNotes: text("resolved_notes"),
    notifiedChannels: jsonb("notified_channels").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("alert_incidents_tenant_idx").on(table.tenantId),
    index("alert_incidents_project_idx").on(table.projectId),
    index("alert_incidents_rule_idx").on(table.ruleId),
    index("alert_incidents_status_idx").on(table.projectId, table.status),
    index("alert_incidents_created_idx").on(table.projectId, table.createdAt),
    index("alert_incidents_severity_idx").on(table.projectId, table.severity),
  ],
);

// 36. Tenant Subscriptions & Stripe Billing (M15 / ADM-FR-004 to ADM-FR-007)
export const tenantSubscriptions = pgTable(
  "tenant_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 120 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 120 }),
    planTier: varchar("plan_tier", { length: 32 }).default("starter").notNull(), // starter, growth, enterprise
    status: varchar("status", { length: 32 }).default("active").notNull(), // active, past_due, canceled, trialing, incomplete
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    monthlyCredits: integer("monthly_credits").default(2000).notNull(),
    monthlyCrawlCredits: integer("monthly_crawl_credits").default(500).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tenant_subs_tenant_idx").on(table.tenantId),
    index("tenant_subs_stripe_cust_idx").on(table.stripeCustomerId),
    index("tenant_subs_stripe_sub_idx").on(table.stripeSubscriptionId),
    index("tenant_subs_status_idx").on(table.status),
  ],
);

// 37. Credit Ledger Entries (M15 / ADM-FR-001, ADM-FR-002, ADM-FR-003)
export const creditLedgerEntries = pgTable(
  "credit_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    entryType: varchar("entry_type", { length: 40 }).notNull(), // plan_allocation, credit_topup, monitoring_run, crawl_page, operator_adjustment, refund
    category: varchar("category", { length: 24 }).default("monitoring").notNull(), // monitoring, crawl
    amount: integer("amount").notNull(), // positive for credits, negative for debits
    balanceAfter: integer("balance_after").notNull(),
    referenceId: varchar("reference_id", { length: 120 }),
    description: text("description").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("credit_ledger_tenant_idx").on(table.tenantId),
    index("credit_ledger_created_idx").on(table.tenantId, table.createdAt),
    index("credit_ledger_category_idx").on(table.tenantId, table.category),
    index("credit_ledger_type_idx").on(table.tenantId, table.entryType),
  ],
);

// 38. Crawl Credits (M15 / ADM-FR-003 separate metering for crawls)
export const crawlCredits = pgTable("crawl_credits", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  available: integer("available").default(500).notNull(),
  used: integer("used").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 39. Operator Audit Logs (M15 / ADM-FR-012, ADM-FR-013)
export const operatorAuditLogs = pgTable(
  "operator_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operatorId: varchar("operator_id", { length: 150 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(), // tenant.pause, tenant.resume, tenant.archive, credits.adjust, tenant.search
    targetTenantId: uuid("target_tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    details: jsonb("details").default({}).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operator_audit_created_idx").on(table.createdAt),
    index("operator_audit_action_idx").on(table.action),
    index("operator_audit_tenant_idx").on(table.targetTenantId),
  ],
);

// Verified marketing memory. Both document and query embeddings use the same model/dimensions.
export const memoryApprovalStatus = pgEnum("memory_approval_status", [
  "draft",
  "approved",
  "rejected",
]);

const memoryColumns = () => ({
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  approvalStatus: memoryApprovalStatus("approval_status").default("draft").notNull(),
  embedding: vector("embedding", { dimensions: 768 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const brandMemory = pgTable(
  "brand_memory",
  {
    ...memoryColumns(),
    brandVoice: text("brand_voice").notNull(),
    toneGuidelines: jsonb("tone_guidelines").$type<string[]>().default([]).notNull(),
    audiencePersonas: jsonb("audience_personas").$type<string[]>().default([]).notNull(),
    negativeKeywords: jsonb("negative_keywords").$type<string[]>().default([]).notNull(),
    negativeClaims: jsonb("negative_claims").$type<string[]>().default([]).notNull(),
  },
  (t) => [index("brand_memory_project_idx").on(t.tenantId, t.projectId)],
);

export const productMemory = pgTable(
  "product_memory",
  {
    ...memoryColumns(),
    name: text("name").notNull(),
    features: jsonb("features").$type<string[]>().default([]).notNull(),
    specs: jsonb("specs").$type<Record<string, string>>().default({}).notNull(),
    pricing: text("pricing").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
  },
  (t) => [
    index("product_memory_project_idx").on(t.tenantId, t.projectId),
    check(
      "product_memory_validity",
      sql`${t.validUntil} IS NULL OR ${t.validFrom} IS NULL OR ${t.validUntil} > ${t.validFrom}`,
    ),
  ],
);

export const questionSourceEnum = pgEnum("question_source", [
  "faq",
  "support_ticket",
  "reddit",
  "survey",
]);
export const questionIntentEnum = pgEnum("question_intent", [
  "awareness",
  "consideration",
  "decision",
  "retention",
]);
export const questionStatusEnum = pgEnum("question_status", [
  "backlog",
  "planned",
  "published",
  "dismissed",
]);

export const customerQuestions = pgTable(
  "customer_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: questionSourceEnum("source").notNull(),
    questionText: text("question_text").notNull(),
    questionHash: varchar("question_hash", { length: 64 }).notNull(),
    intent: questionIntentEnum("intent").notNull(),
    demandScore: integer("demand_score").default(1).notNull(),
    businessPriority: integer("business_priority").default(50).notNull(),
    status: questionStatusEnum("status").default("backlog").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("customer_questions_project_source_hash_unique").on(
      t.projectId,
      t.source,
      t.questionHash,
    ),
    index("customer_questions_backlog_idx").on(t.tenantId, t.projectId, t.status),
    check("customer_questions_demand_range", sql`${t.demandScore} BETWEEN 0 AND 100`),
    check("customer_questions_priority_range", sql`${t.businessPriority} BETWEEN 0 AND 100`),
  ],
);

export const studioStatusEnum = pgEnum("studio_status", [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "failed",
]);
export const studioDrafts = pgTable(
  "studio_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    document: jsonb("document").notNull(),
    validation: jsonb("validation"),
    revision: integer("revision").default(1).notNull(),
    status: studioStatusEnum("status").default("draft").notNull(),
    approvedRevision: integer("approved_revision"),
    approvedBy: uuid("approved_by").references(() => users.id),
    scheduledTime: timestamp("scheduled_time", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("studio_drafts_project_idx").on(t.tenantId, t.projectId)],
);

export const publishingConnections = pgTable(
  "publishing_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    channels: jsonb("channels").default([]).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("publishing_connections_project_provider_unique").on(t.projectId, t.provider),
  ],
);

export const studioMedia = pgTable("studio_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  publicUrl: text("public_url").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  ready: boolean("ready").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const publishingDeliveries = pgTable(
  "publishing_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => studioDrafts.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    platform: text("platform").notNull(),
    channelId: text("channel_id").notNull(),
    mediaIds: jsonb("media_ids").default([]).notNull(),
    schedulingType: text("scheduling_type").default("automatic").notNull(),
    state: text("state").default("queued").notNull(),
    remoteId: text("remote_id"),
    remoteUrl: text("remote_url"),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    notice: text("notice"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("publishing_deliveries_target_unique").on(
      t.draftId,
      t.revision,
      t.platform,
      t.channelId,
    ),
    index("publishing_deliveries_due_idx").on(t.state, t.nextAttemptAt),
  ],
);

export const performanceMemory = pgTable(
  "performance_memory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id").references(() => publishingDeliveries.id, {
      onDelete: "set null",
    }),
    draftId: uuid("draft_id").references(() => studioDrafts.id, { onDelete: "set null" }),
    platform: text("platform").notNull(),
    channelId: text("channel_id").notNull(),
    remotePostId: text("remote_post_id"),
    topicCluster: varchar("topic_cluster", { length: 255 }).notNull(),
    assetFormat: varchar("asset_format", { length: 100 }).notNull(),
    hookStyle: varchar("hook_style", { length: 100 }).notNull(),
    hookText: text("hook_text").notNull(),
    audienceIntent: varchar("audience_intent", { length: 50 }).default("awareness").notNull(),
    impressions: integer("impressions").default(0).notNull(),
    reach: integer("reach").default(0).notNull(),
    likes: integer("likes").default(0).notNull(),
    shares: integer("shares").default(0).notNull(),
    comments: integer("comments").default(0).notNull(),
    clicks: integer("clicks").default(0).notNull(),
    conversions: integer("conversions").default(0).notNull(),
    engagementCount: integer("engagement_count").default(0).notNull(),
    engagementRate: numeric("engagement_rate", { precision: 7, scale: 4 })
      .default("0.0000")
      .notNull(),
    conversionTag: varchar("conversion_tag", { length: 100 }),
    performanceScore: numeric("performance_score", { precision: 6, scale: 2 })
      .default("0.00")
      .notNull(),
    isTopPerformer: boolean("is_top_performer").default(false).notNull(),
    winningPatterns: jsonb("winning_patterns").$type<string[]>().default([]).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("performance_memory_tenant_project_idx").on(t.tenantId, t.projectId),
    index("performance_memory_cluster_score_idx").on(
      t.projectId,
      t.topicCluster,
      t.performanceScore,
    ),
    index("performance_memory_top_performer_idx").on(t.projectId, t.topicCluster, t.isTopPerformer),
    uniqueIndex("performance_memory_remote_post_unique").on(
      t.projectId,
      t.platform,
      t.remotePostId,
    ),
  ],
);
