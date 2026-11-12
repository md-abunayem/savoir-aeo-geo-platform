-- Migration: 0020_content_intelligence
-- Phase 3 Step 3.3: M9 Content Intelligence (CNT-FR-001 to CNT-FR-009)

CREATE TABLE IF NOT EXISTS "content_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "path" varchar(1024) NOT NULL,
  "title" varchar(500),
  "meta_description" text,
  "word_count" integer DEFAULT 0 NOT NULL,
  "content_score" integer DEFAULT 0 NOT NULL,
  "answer_first_score" integer DEFAULT 0 NOT NULL,
  "entity_clarity_score" integer DEFAULT 0 NOT NULL,
  "schema_score" integer DEFAULT 0 NOT NULL,
  "structure_score" integer DEFAULT 0 NOT NULL,
  "credibility_score" integer DEFAULT 0 NOT NULL,
  "mapped_prompt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "prompt_clusters" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_modified" timestamp with time zone,
  "is_stale" boolean DEFAULT false NOT NULL,
  "cannibalized_prompt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_project_idx" ON "content_items" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_tenant_idx" ON "content_items" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_score_idx" ON "content_items" ("project_id", "content_score");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_items_project_url_idx" ON "content_items" ("project_id", "url");
--> statement-breakpoint
ALTER TABLE "content_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "content_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_items_policy ON "content_items" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_gaps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "prompt_id" uuid NOT NULL REFERENCES "monitoring_prompts"("id") ON DELETE CASCADE,
  "prompt_text" text NOT NULL,
  "cluster_name" varchar(200) DEFAULT 'General' NOT NULL,
  "brand_vis_score" numeric(5, 4) DEFAULT '0.0000' NOT NULL,
  "demand_index" integer DEFAULT 50 NOT NULL,
  "priority_score" numeric(5, 2) DEFAULT '0.00' NOT NULL,
  "closest_owned_page_url" text,
  "similarity_score" numeric(5, 4) DEFAULT '0.0000' NOT NULL,
  "top_cited_competitor_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "suggested_action" text NOT NULL,
  "status" varchar(50) DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_gaps_project_idx" ON "content_gaps" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_gaps_tenant_idx" ON "content_gaps" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_gaps_priority_idx" ON "content_gaps" ("project_id", "priority_score");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_gaps_status_idx" ON "content_gaps" ("project_id", "status");
--> statement-breakpoint
ALTER TABLE "content_gaps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "content_gaps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_gaps_policy ON "content_gaps" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "gap_id" uuid REFERENCES "content_gaps"("id") ON DELETE SET NULL,
  "title" varchar(500) NOT NULL,
  "target_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "primary_intent" varchar(100) DEFAULT 'informational' NOT NULL,
  "questions_to_answer" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "suggested_outline" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "target_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "facts_and_statistics" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recommended_schemas" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "internal_linking_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sources_to_cite" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "markdown_content" text NOT NULL,
  "status" varchar(50) DEFAULT 'draft' NOT NULL,
  "label" varchar(50) DEFAULT 'Estimated' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_briefs_project_idx" ON "content_briefs" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_briefs_tenant_idx" ON "content_briefs" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_briefs_created_idx" ON "content_briefs" ("project_id", "created_at");
--> statement-breakpoint
ALTER TABLE "content_briefs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "content_briefs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY content_briefs_policy ON "content_briefs" TO CURRENT_USER USING (true) WITH CHECK (true);

