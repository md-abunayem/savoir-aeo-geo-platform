-- Migration: 0016_competitor_intelligence
-- Step 2.3: M7 Competitor Intelligence (CMP)

-- 1. Extend competitors table with competitor_type and updated_at
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "competitor_type" varchar(30) DEFAULT 'direct' NOT NULL;
--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

-- 2. Competitor auto-discovery candidates table (CMP-FR-010, CMP-FR-016, Feature CMP-F1)
CREATE TABLE IF NOT EXISTS "competitor_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(150) NOT NULL,
  "domain" text,
  "mention_count" integer DEFAULT 0 NOT NULL,
  "mention_frequency" numeric(5, 4) DEFAULT 0 NOT NULL,
  "co_occurrence_count" integer DEFAULT 0 NOT NULL,
  "engines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sample_answer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "entity_type" varchar(50) DEFAULT 'competitor' NOT NULL,
  "status" varchar(30) DEFAULT 'suggested' NOT NULL,
  "rejected_at" timestamp with time zone,
  "snoozed_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "competitor_candidates_project_name_idx" ON "competitor_candidates" ("project_id", lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_candidates_project_status_idx" ON "competitor_candidates" ("project_id", "status");
--> statement-breakpoint
ALTER TABLE "competitor_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "competitor_candidates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY competitor_candidates_policy ON "competitor_candidates" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 3. Competitive gaps table (CMP-FR-012, CMP-FR-015)
CREATE TABLE IF NOT EXISTS "competitive_gaps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "competitor_id" uuid NOT NULL REFERENCES "competitors"("id") ON DELETE CASCADE,
  "prompt_id" uuid NOT NULL REFERENCES "monitoring_prompts"("id") ON DELETE CASCADE,
  "engine" varchar(40) DEFAULT 'all' NOT NULL,
  "competitor_vis" numeric(5, 4) DEFAULT 0 NOT NULL,
  "brand_vis" numeric(5, 4) DEFAULT 0 NOT NULL,
  "gap_score" numeric(6, 2) DEFAULT 0 NOT NULL,
  "prompt_weight" numeric(5, 4) DEFAULT 1.0 NOT NULL,
  "demand_index" integer DEFAULT 50 NOT NULL,
  "priority" integer DEFAULT 1 NOT NULL,
  "reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "competitive_gaps_unique_idx" ON "competitive_gaps" ("project_id", "competitor_id", "prompt_id", "engine");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitive_gaps_project_score_idx" ON "competitive_gaps" ("project_id", "gap_score" DESC);
--> statement-breakpoint
ALTER TABLE "competitive_gaps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "competitive_gaps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY competitive_gaps_policy ON "competitive_gaps" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 4. Grant runtime access for savoir_runtime role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'savoir_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "competitors" TO savoir_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "competitor_candidates" TO savoir_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "competitive_gaps" TO savoir_runtime;
  END IF;
END $$;

