-- Migration 0014: AI Visibility Analytics Engine (VIS & M3)

-- 1. Metric facts table (SRS Section 6.2 & Section 9)
CREATE TABLE IF NOT EXISTS public.metric_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  date date NOT NULL,
  engine varchar(40) DEFAULT 'all' NOT NULL,
  market varchar(20) DEFAULT 'all' NOT NULL,
  entity_id uuid,
  entity_type varchar(20) DEFAULT 'brand' NOT NULL,
  metric_name varchar(50) NOT NULL,
  value numeric(8, 4) NOT NULL,
  n integer DEFAULT 0 NOT NULL,
  ci_low numeric(8, 4),
  ci_high numeric(8, 4),
  label varchar(20) DEFAULT 'Observed' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS metric_facts_unique_idx 
  ON public.metric_facts (project_id, date, engine, market, entity_id, metric_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS metric_facts_project_date_idx 
  ON public.metric_facts (project_id, date DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS metric_facts_tenant_project_idx 
  ON public.metric_facts (tenant_id, project_id);
--> statement-breakpoint

-- 2. Saved views table (VIS-FR-011)
CREATE TABLE IF NOT EXISTS public.saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name varchar(150) NOT NULL,
  filters jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_views_project_idx ON public.saved_views (project_id);
--> statement-breakpoint

-- 3. Metric goals table (VIS-FR-011)
CREATE TABLE IF NOT EXISTS public.metric_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  metric_name varchar(50) NOT NULL,
  target_value numeric(8, 4) NOT NULL,
  deadline date,
  status varchar(20) DEFAULT 'active' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS metric_goals_project_idx ON public.metric_goals (project_id, status);
--> statement-breakpoint

-- 4. Row Level Security
ALTER TABLE public.metric_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_views FORCE ROW LEVEL SECURITY;
ALTER TABLE public.metric_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_goals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY metric_facts_tenant ON public.metric_facts TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY metric_facts_superuser ON public.metric_facts TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY saved_views_tenant ON public.saved_views TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY saved_views_superuser ON public.saved_views TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY metric_goals_tenant ON public.metric_goals TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY metric_goals_superuser ON public.metric_goals TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 5. Grants to savoir_runtime
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metric_facts TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metric_goals TO savoir_runtime;

