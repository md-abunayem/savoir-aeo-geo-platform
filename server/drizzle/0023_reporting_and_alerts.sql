-- Migration: 0023_reporting_and_alerts
-- Phase 5 Step 5.1: M13 Reporting & Alerts (RPT)

CREATE TABLE IF NOT EXISTS "report_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "frequency" varchar(32) NOT NULL,
  "day_of_week" integer,
  "day_of_month" integer,
  "recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "format" varchar(20) DEFAULT 'pdf' NOT NULL,
  "sections" jsonb DEFAULT '["visibility", "citations", "competitors", "technical", "content", "traffic", "actions"]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_run_at" timestamp with time zone,
  "last_run_status" varchar(32),
  "next_run_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_tenant_idx" ON "report_schedules" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_project_idx" ON "report_schedules" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_active_idx" ON "report_schedules" ("project_id", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_schedules_next_run_idx" ON "report_schedules" ("is_active", "next_run_at");
--> statement-breakpoint
ALTER TABLE "report_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_schedules_policy ON "report_schedules" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "generated_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "schedule_id" uuid REFERENCES "report_schedules"("id") ON DELETE SET NULL,
  "title" varchar(255) NOT NULL,
  "date_window_days" integer DEFAULT 30 NOT NULL,
  "format" varchar(20) DEFAULT 'pdf' NOT NULL,
  "status" varchar(32) DEFAULT 'completed' NOT NULL,
  "summary_kpis" jsonb NOT NULL,
  "content_payload" jsonb NOT NULL,
  "download_url" text,
  "delivered_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "dispatched_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_reports_tenant_idx" ON "generated_reports" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_reports_project_idx" ON "generated_reports" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_reports_schedule_idx" ON "generated_reports" ("schedule_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_reports_created_idx" ON "generated_reports" ("project_id", "created_at");
--> statement-breakpoint
ALTER TABLE "generated_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "generated_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY generated_reports_policy ON "generated_reports" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "alert_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "rule_type" varchar(64) NOT NULL,
  "threshold" jsonb NOT NULL,
  "severity" varchar(32) DEFAULT 'warning' NOT NULL,
  "channels" jsonb DEFAULT '["in_app", "email"]'::jsonb NOT NULL,
  "email_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cooldown_hours" integer DEFAULT 24 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_triggered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_rules_tenant_idx" ON "alert_rules" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_rules_project_idx" ON "alert_rules" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_rules_type_idx" ON "alert_rules" ("project_id", "rule_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_rules_active_idx" ON "alert_rules" ("project_id", "is_active");
--> statement-breakpoint
ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "alert_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY alert_rules_policy ON "alert_rules" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "alert_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "rule_id" uuid REFERENCES "alert_rules"("id") ON DELETE SET NULL,
  "rule_type" varchar(64) NOT NULL,
  "severity" varchar(32) DEFAULT 'warning' NOT NULL,
  "title" varchar(255) NOT NULL,
  "message" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by" varchar(255),
  "resolved_at" timestamp with time zone,
  "resolved_notes" text,
  "notified_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_incidents_tenant_idx" ON "alert_incidents" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_incidents_project_idx" ON "alert_incidents" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_incidents_rule_idx" ON "alert_incidents" ("rule_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_incidents_status_idx" ON "alert_incidents" ("project_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_incidents_created_idx" ON "alert_incidents" ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_incidents_severity_idx" ON "alert_incidents" ("project_id", "severity");
--> statement-breakpoint
ALTER TABLE "alert_incidents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "alert_incidents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY alert_incidents_policy ON "alert_incidents" TO CURRENT_USER USING (true) WITH CHECK (true);

