CREATE TYPE public.question_source AS ENUM ('faq', 'support_ticket', 'reddit', 'survey');
CREATE TYPE public.question_intent AS ENUM ('awareness', 'consideration', 'decision', 'retention');
CREATE TYPE public.question_status AS ENUM ('backlog', 'planned', 'published', 'dismissed');
--> statement-breakpoint
CREATE TABLE public.customer_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source public.question_source NOT NULL,
  question_text text NOT NULL,
  question_hash varchar(64) NOT NULL,
  intent public.question_intent NOT NULL,
  demand_score integer DEFAULT 1 NOT NULL,
  business_priority integer DEFAULT 50 NOT NULL,
  status public.question_status DEFAULT 'backlog' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT customer_questions_demand_range CHECK (demand_score BETWEEN 0 AND 100),
  CONSTRAINT customer_questions_priority_range CHECK (business_priority BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX customer_questions_project_source_hash_unique ON public.customer_questions (project_id, source, question_hash);
CREATE INDEX customer_questions_backlog_idx ON public.customer_questions (tenant_id, project_id, status);
--> statement-breakpoint
ALTER TABLE public.customer_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_questions_internal ON public.customer_questions TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY customer_questions_owner ON public.customer_questions TO savoir_runtime
USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = customer_questions.project_id AND p.tenant_id = customer_questions.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = customer_questions.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
)
WITH CHECK (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = customer_questions.project_id AND p.tenant_id = customer_questions.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = customer_questions.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_questions TO savoir_runtime;
