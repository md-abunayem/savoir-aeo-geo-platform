-- Migration: 0018_technical_aeo_auditing
-- Phase 3 Step 3.1: M8 Technical AEO Auditing (TEC-FR-001 to TEC-FR-016)

-- 1. Technical AEO Audits table
CREATE TABLE IF NOT EXISTS "technical_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "status" varchar(30) DEFAULT 'pending' NOT NULL,
  "crawl_type" varchar(30) DEFAULT 'full_site' NOT NULL,
  "target_domain" varchar(255) NOT NULL,
  "pages_crawled" integer DEFAULT 0 NOT NULL,
  "pages_limit" integer DEFAULT 500 NOT NULL,
  "overall_score" integer DEFAULT 0 NOT NULL,
  "grade" varchar(5) DEFAULT 'C' NOT NULL,
  "category_scores" jsonb DEFAULT '{"botAccess": 0, "indexability": 0, "schema": 0, "answerStructure": 0, "performanceTrust": 0, "agentReadability": 0}'::jsonb NOT NULL,
  "bot_matrix" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "issues_summary" jsonb DEFAULT '{"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0, "total": 0}'::jsonb NOT NULL,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audits_project_created_idx" ON "technical_audits" ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audits_tenant_idx" ON "technical_audits" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audits_status_idx" ON "technical_audits" ("status");
--> statement-breakpoint
ALTER TABLE "technical_audits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "technical_audits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY technical_audits_policy ON "technical_audits" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 2. Technical Audit Pages table
CREATE TABLE IF NOT EXISTS "technical_audit_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "audit_id" uuid NOT NULL REFERENCES "technical_audits"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "path" varchar(1024) NOT NULL,
  "status_code" integer DEFAULT 200 NOT NULL,
  "is_indexable" boolean DEFAULT true NOT NULL,
  "canonical_url" text,
  "canonical_status" varchar(50) DEFAULT 'match' NOT NULL,
  "page_score" integer DEFAULT 0 NOT NULL,
  "word_count" integer DEFAULT 0 NOT NULL,
  "heading_counts" jsonb DEFAULT '{"h1": 0, "h2": 0, "h3": 0, "h4": 0}'::jsonb NOT NULL,
  "answer_first_detected" boolean DEFAULT false NOT NULL,
  "faq_blocks_detected" boolean DEFAULT false NOT NULL,
  "schemas_detected" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "has_js_dom_diff" boolean DEFAULT false NOT NULL,
  "dom_diff_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "load_time_ms" integer DEFAULT 0 NOT NULL,
  "issues_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audit_pages_audit_idx" ON "technical_audit_pages" ("audit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audit_pages_project_url_idx" ON "technical_audit_pages" ("project_id", "url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audit_pages_score_idx" ON "technical_audit_pages" ("audit_id", "page_score");
--> statement-breakpoint
ALTER TABLE "technical_audit_pages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "technical_audit_pages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY technical_audit_pages_policy ON "technical_audit_pages" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 3. Technical Audit Issues table
CREATE TABLE IF NOT EXISTS "technical_audit_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "audit_id" uuid NOT NULL REFERENCES "technical_audits"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "page_id" uuid REFERENCES "technical_audit_pages"("id") ON DELETE CASCADE,
  "category" varchar(50) NOT NULL,
  "severity" varchar(20) NOT NULL,
  "code" varchar(100) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "recommendation" text NOT NULL,
  "fix_snippet" text,
  "affected_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audit_issues_audit_sev_idx" ON "technical_audit_issues" ("audit_id", "severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audit_issues_audit_cat_idx" ON "technical_audit_issues" ("audit_id", "category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audit_issues_project_idx" ON "technical_audit_issues" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "technical_audit_issues_page_idx" ON "technical_audit_issues" ("page_id");
--> statement-breakpoint
ALTER TABLE "technical_audit_issues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "technical_audit_issues" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY technical_audit_issues_policy ON "technical_audit_issues" TO CURRENT_USER USING (true) WITH CHECK (true);

