-- Migration: 0021_action_center
-- Phase 4: Optimization Action Center & Closed-Loop Verification (M10 / ACT-FR-001 to ACT-FR-008)

CREATE TABLE IF NOT EXISTS "action_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "title" varchar(500) NOT NULL,
  "description" text NOT NULL,
  "category" varchar(64) NOT NULL,
  "source_module" varchar(32) NOT NULL,
  "source_id" varchar(255),
  "dedup_key" varchar(255) NOT NULL,
  "status" varchar(32) DEFAULT 'todo' NOT NULL,
  "dismiss_reason" text,
  "priority_score" numeric(5, 2) DEFAULT '50.00' NOT NULL,
  "impact" integer DEFAULT 5 NOT NULL,
  "confidence" numeric(3, 2) DEFAULT '0.80' NOT NULL,
  "effort" varchar(8) DEFAULT 'M' NOT NULL,
  "owner" varchar(255),
  "due_date" timestamp with time zone,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "fix_guidance" jsonb,
  "verification_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "verification_notes" text,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_project_idx" ON "action_items" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_tenant_idx" ON "action_items" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_status_idx" ON "action_items" ("project_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_priority_idx" ON "action_items" ("project_id", "priority_score");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_category_idx" ON "action_items" ("project_id", "category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_items_dedup_idx" ON "action_items" ("project_id", "dedup_key");
--> statement-breakpoint
ALTER TABLE "action_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY action_items_policy ON "action_items" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "action_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action_id" uuid NOT NULL REFERENCES "action_items"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "user_name" varchar(255) DEFAULT 'Team Member' NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_comments_action_idx" ON "action_comments" ("action_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_comments_tenant_idx" ON "action_comments" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "action_comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_comments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY action_comments_policy ON "action_comments" TO CURRENT_USER USING (true) WITH CHECK (true);

