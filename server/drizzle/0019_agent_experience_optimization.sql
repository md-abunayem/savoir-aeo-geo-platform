-- Migration: 0019_agent_experience_optimization
-- Phase 3 Step 3.2: M16 Agent Experience Optimization (AXO-FR-001 to AXO-FR-010)

CREATE TABLE IF NOT EXISTS "agent_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "policy_preset" varchar(50) DEFAULT 'search_only' NOT NULL,
  "robots_txt_content" text NOT NULL,
  "bot_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "training_bots_disallowed" boolean DEFAULT true NOT NULL,
  "search_bots_allowed" boolean DEFAULT true NOT NULL,
  "custom_directives" text,
  "llms_txt_draft" text,
  "llms_full_txt_draft" text,
  "llms_validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "schema_templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_policies_project_idx" ON "agent_policies" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_policies_tenant_idx" ON "agent_policies" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "agent_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_policies_policy ON "agent_policies" TO CURRENT_USER USING (true) WITH CHECK (true);

