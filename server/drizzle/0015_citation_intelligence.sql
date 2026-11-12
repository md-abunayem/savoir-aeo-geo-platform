-- Migration 0015: Citation Intelligence (CIT & M6)

-- 1. Source domains classification and allow/deny rules (CIT-FR-002, CIT-FR-010)
CREATE TABLE IF NOT EXISTS public.source_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  domain varchar(255) NOT NULL,
  source_type varchar(50) DEFAULT 'other' NOT NULL,
  is_allowed boolean DEFAULT true NOT NULL,
  is_denied boolean DEFAULT false NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS source_domains_project_domain_unique 
  ON public.source_domains (project_id, domain);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS source_domains_tenant_project_idx 
  ON public.source_domains (tenant_id, project_id);
--> statement-breakpoint

-- 2. Broken & redirected citations tracking (CIT-FR-009)
CREATE TABLE IF NOT EXISTS public.broken_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  citation_id uuid REFERENCES public.citations(id) ON DELETE CASCADE,
  url text NOT NULL,
  normalized_url text NOT NULL,
  domain varchar(255) NOT NULL,
  status_code integer NOT NULL,
  redirect_url text,
  error_message text,
  task_status varchar(20) DEFAULT 'open' NOT NULL,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS broken_citations_project_status_idx 
  ON public.broken_citations (project_id, task_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS broken_citations_tenant_project_idx 
  ON public.broken_citations (tenant_id, project_id);
--> statement-breakpoint

-- 3. Citation gap opportunities (CIT-FR-005, CIT-FR-008)
CREATE TABLE IF NOT EXISTS public.citation_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  domain varchar(255) NOT NULL,
  page_url text,
  source_type varchar(50) DEFAULT 'other' NOT NULL,
  gap_runs_count integer DEFAULT 0 NOT NULL,
  opportunity_score numeric(6, 2) DEFAULT 0 NOT NULL,
  competitor_names jsonb DEFAULT '[]'::jsonb NOT NULL,
  prompt_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  suggested_action text NOT NULL,
  status varchar(20) DEFAULT 'open' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS citation_opportunities_project_score_idx 
  ON public.citation_opportunities (project_id, opportunity_score DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS citation_opportunities_tenant_project_idx 
  ON public.citation_opportunities (tenant_id, project_id);
--> statement-breakpoint

-- 4. Row Level Security
ALTER TABLE public.source_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_domains FORCE ROW LEVEL SECURITY;
ALTER TABLE public.broken_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broken_citations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.citation_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citation_opportunities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY source_domains_tenant ON public.source_domains TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY source_domains_superuser ON public.source_domains TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY broken_citations_tenant ON public.broken_citations TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY broken_citations_superuser ON public.broken_citations TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY citation_opportunities_tenant ON public.citation_opportunities TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY citation_opportunities_superuser ON public.citation_opportunities TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 5. Grants to savoir_runtime
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_domains TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broken_citations TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.citation_opportunities TO savoir_runtime;

