-- Migration 0013: Answer Processing Pipeline (ANS & M5)

-- 1. Answers table
CREATE TABLE IF NOT EXISTS public.answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.monitoring_runs(id) ON DELETE CASCADE,
  prompt_id uuid REFERENCES public.monitoring_prompts(id) ON DELETE SET NULL,
  engine varchar(40) NOT NULL,
  engine_model varchar(150),
  geo varchar(10) DEFAULT 'US' NOT NULL,
  language varchar(10) DEFAULT 'en' NOT NULL,
  text text NOT NULL,
  text_ref text,
  text_hash varchar(64) NOT NULL,
  parser_version varchar(50) DEFAULT 'v1.0.0' NOT NULL,
  has_citations boolean DEFAULT false NOT NULL,
  refusal_flag boolean DEFAULT false NOT NULL,
  source_type varchar(30) DEFAULT 'official_api' NOT NULL,
  search_queries jsonb DEFAULT '[]'::jsonb NOT NULL,
  latency_ms integer,
  tokens_used integer,
  raw_response jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT answers_run_unique UNIQUE (run_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS answers_project_created_idx ON public.answers USING btree (project_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS answers_tenant_project_idx ON public.answers USING btree (tenant_id, project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS answers_prompt_idx ON public.answers USING btree (prompt_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS answers_engine_idx ON public.answers USING btree (project_id, engine);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS answers_fts_idx ON public.answers USING gin (to_tsvector('english', text));
--> statement-breakpoint

-- 2. Mentions table
CREATE TABLE IF NOT EXISTS public.mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  answer_id uuid NOT NULL REFERENCES public.answers(id) ON DELETE CASCADE,
  entity_type varchar(20) NOT NULL,
  entity_id uuid,
  entity_name varchar(200) NOT NULL,
  matched_text varchar(200) NOT NULL,
  position_index integer NOT NULL,
  list_rank integer,
  sentiment integer DEFAULT 0 NOT NULL,
  confidence numeric(4, 3) DEFAULT 1.000 NOT NULL,
  snippet text NOT NULL,
  review_status varchar(20) DEFAULT 'auto' NOT NULL,
  label varchar(20) DEFAULT 'Observed' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mentions_answer_idx ON public.mentions USING btree (answer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mentions_project_entity_idx ON public.mentions USING btree (project_id, entity_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mentions_project_sentiment_idx ON public.mentions USING btree (project_id, sentiment);
--> statement-breakpoint

-- 3. Citations table
CREATE TABLE IF NOT EXISTS public.citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  answer_id uuid NOT NULL REFERENCES public.answers(id) ON DELETE CASCADE,
  url text NOT NULL,
  normalized_url text NOT NULL,
  domain varchar(255) NOT NULL,
  source_type varchar(50) DEFAULT 'other' NOT NULL,
  anchor_text text,
  order_index integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS citations_answer_idx ON public.citations USING btree (answer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS citations_project_domain_idx ON public.citations USING btree (project_id, domain);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS citations_project_source_type_idx ON public.citations USING btree (project_id, source_type);
--> statement-breakpoint

-- 4. Claims table
CREATE TABLE IF NOT EXISTS public.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  answer_id uuid NOT NULL REFERENCES public.answers(id) ON DELETE CASCADE,
  entity_name varchar(200) NOT NULL,
  claim_text text NOT NULL,
  theme varchar(50) NOT NULL,
  sentiment integer DEFAULT 0 NOT NULL,
  confidence numeric(4, 3) DEFAULT 0.800 NOT NULL,
  label varchar(20) DEFAULT 'Estimated' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS claims_answer_idx ON public.claims USING btree (answer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS claims_project_theme_idx ON public.claims USING btree (project_id, theme);
--> statement-breakpoint

-- 5. Answer flags table
CREATE TABLE IF NOT EXISTS public.answer_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  answer_id uuid NOT NULL REFERENCES public.answers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason varchar(80) NOT NULL,
  note text,
  tags jsonb DEFAULT '[]'::jsonb NOT NULL,
  status varchar(20) DEFAULT 'open' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS answer_flags_answer_idx ON public.answer_flags USING btree (answer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS answer_flags_project_status_idx ON public.answer_flags USING btree (project_id, status);
--> statement-breakpoint

-- 6. Row Level Security
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.answer_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_flags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY answers_tenant ON public.answers TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY answers_superuser ON public.answers TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY mentions_tenant ON public.mentions TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY mentions_superuser ON public.mentions TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY citations_tenant ON public.citations TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY citations_superuser ON public.citations TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY claims_tenant ON public.claims TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY claims_superuser ON public.claims TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY answer_flags_tenant ON public.answer_flags TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY answer_flags_superuser ON public.answer_flags TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 7. Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.answers TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mentions TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.citations TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claims TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.answer_flags TO savoir_runtime;

