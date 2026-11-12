-- Migration: 0017_public_grader
-- Step 2.4: M19 Free AI Search Grader (HG)

-- 1. Create grader_reports table (HG-01 to HG-24, HG-FR-001 to HG-FR-006)
CREATE TABLE IF NOT EXISTS "grader_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "share_token" varchar(64) NOT NULL UNIQUE,
  "brand_name" varchar(150) NOT NULL,
  "domain" varchar(255) NOT NULL,
  "normalized_domain" varchar(255) NOT NULL,
  "category" varchar(100) DEFAULT 'General' NOT NULL,
  "country" varchar(10) DEFAULT 'US' NOT NULL,
  "language" varchar(10) DEFAULT 'en' NOT NULL,
  "competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(30) DEFAULT 'pending' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "current_stage" varchar(100) DEFAULT 'Initialized' NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "grade" varchar(5) DEFAULT 'C' NOT NULL,
  "metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "brand_perception" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "technical_audit" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cost_usd" numeric(6, 4) DEFAULT 0.0000 NOT NULL,
  "ip_hash" varchar(64) NOT NULL,
  "device_hash" varchar(64),
  "email" varchar(255),
  "email_opt_in" boolean DEFAULT false NOT NULL,
  "converted_at" timestamp with time zone,
  "converted_tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
  "converted_project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 2. Indexes for fast lookup, caching and rate limiting
CREATE INDEX IF NOT EXISTS "grader_reports_share_token_idx" ON "grader_reports" ("share_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grader_reports_cache_idx" ON "grader_reports" ("normalized_domain", lower("brand_name"), "country", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grader_reports_ip_created_idx" ON "grader_reports" ("ip_hash", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grader_reports_domain_created_idx" ON "grader_reports" ("normalized_domain", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grader_reports_expires_at_idx" ON "grader_reports" ("expires_at");
--> statement-breakpoint

-- 3. Row Level Security policies
ALTER TABLE "grader_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "grader_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY grader_reports_current_user_policy ON "grader_reports" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'savoir_runtime') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "grader_reports" TO savoir_runtime';
    EXECUTE 'CREATE POLICY grader_reports_runtime_policy ON "grader_reports" TO savoir_runtime USING (true) WITH CHECK (true)';
  END IF;
END $$;

