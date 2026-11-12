-- Migration: 0022_integrations_and_traffic
-- Phase 4 Step 4.2: M14 Integrations (ITG) & M11 AI Traffic Analytics (TRF)

CREATE TABLE IF NOT EXISTS "integration_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "provider" varchar(50) NOT NULL,
  "status" varchar(50) DEFAULT 'connected' NOT NULL,
  "account_email" varchar(255),
  "property_id" varchar(255),
  "property_name" varchar(255),
  "scopes_granted" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "encrypted_tokens" text,
  "last_sync_at" timestamp with time zone,
  "last_sync_status" varchar(50) DEFAULT 'pending' NOT NULL,
  "last_sync_error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_conn_project_idx" ON "integration_connections" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_conn_tenant_idx" ON "integration_connections" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_conn_provider_idx" ON "integration_connections" ("project_id", "provider");
--> statement-breakpoint
ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_connections_policy ON "integration_connections" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "gsc_performance_facts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "query" text NOT NULL,
  "page" text NOT NULL,
  "date" varchar(32) NOT NULL,
  "device" varchar(50) DEFAULT 'DESKTOP' NOT NULL,
  "country" varchar(10) DEFAULT 'usa' NOT NULL,
  "impressions" integer DEFAULT 0 NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  "ctr" numeric(5, 4) DEFAULT '0.0000' NOT NULL,
  "position" numeric(5, 2) DEFAULT '0.00' NOT NULL,
  "is_question_query" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsc_facts_project_idx" ON "gsc_performance_facts" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsc_facts_tenant_idx" ON "gsc_performance_facts" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsc_facts_project_date_idx" ON "gsc_performance_facts" ("project_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsc_facts_question_idx" ON "gsc_performance_facts" ("project_id", "is_question_query");
--> statement-breakpoint
ALTER TABLE "gsc_performance_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "gsc_performance_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY gsc_performance_facts_policy ON "gsc_performance_facts" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traffic_analytics_facts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "date" varchar(32) NOT NULL,
  "source" varchar(255) NOT NULL,
  "medium" varchar(100) NOT NULL,
  "landing_page" text NOT NULL,
  "is_ai_referral" boolean DEFAULT false NOT NULL,
  "ai_engine" varchar(50),
  "sessions" integer DEFAULT 0 NOT NULL,
  "engaged_sessions" integer DEFAULT 0 NOT NULL,
  "users" integer DEFAULT 0 NOT NULL,
  "conversions" integer DEFAULT 0 NOT NULL,
  "revenue" numeric(10, 2) DEFAULT '0.00' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_facts_project_idx" ON "traffic_analytics_facts" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_facts_tenant_idx" ON "traffic_analytics_facts" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_facts_date_idx" ON "traffic_analytics_facts" ("project_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_facts_ai_idx" ON "traffic_analytics_facts" ("project_id", "is_ai_referral");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_facts_engine_idx" ON "traffic_analytics_facts" ("project_id", "ai_engine");
--> statement-breakpoint
ALTER TABLE "traffic_analytics_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "traffic_analytics_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY traffic_analytics_facts_policy ON "traffic_analytics_facts" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "key_prefix" varchar(16) NOT NULL,
  "key_hash" varchar(128) NOT NULL,
  "scopes" jsonb DEFAULT '["read"]'::jsonb NOT NULL,
  "rate_limit_rpm" integer DEFAULT 60 NOT NULL,
  "rate_limit_burst" integer DEFAULT 120 NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_api_keys_tenant_idx" ON "tenant_api_keys" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_api_keys_project_idx" ON "tenant_api_keys" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_api_keys_hash_idx" ON "tenant_api_keys" ("key_hash");
--> statement-breakpoint
ALTER TABLE "tenant_api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_api_keys_policy ON "tenant_api_keys" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "description" varchar(255),
  "secret" varchar(128) NOT NULL,
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "last_dispatched_at" timestamp with time zone,
  "last_response_code" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_endpoints_tenant_idx" ON "webhook_endpoints" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_endpoints_project_idx" ON "webhook_endpoints" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_endpoints_active_idx" ON "webhook_endpoints" ("project_id", "is_active");
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY webhook_endpoints_policy ON "webhook_endpoints" TO CURRENT_USER USING (true) WITH CHECK (true);

