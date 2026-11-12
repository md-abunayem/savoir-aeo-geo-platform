CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE public.memory_approval_status AS ENUM ('draft', 'approved', 'rejected');
--> statement-breakpoint
CREATE TABLE public.brand_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  brand_voice text NOT NULL,
  tone_guidelines jsonb DEFAULT '[]'::jsonb NOT NULL,
  audience_personas jsonb DEFAULT '[]'::jsonb NOT NULL,
  negative_keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
  negative_claims jsonb DEFAULT '[]'::jsonb NOT NULL,
  approval_status public.memory_approval_status DEFAULT 'draft' NOT NULL,
  embedding vector(768) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.product_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  features jsonb DEFAULT '[]'::jsonb NOT NULL,
  specs jsonb DEFAULT '{}'::jsonb NOT NULL,
  pricing text NOT NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  approval_status public.memory_approval_status DEFAULT 'draft' NOT NULL,
  embedding vector(768) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT product_memory_validity CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);
--> statement-breakpoint
CREATE INDEX brand_memory_project_idx ON public.brand_memory (tenant_id, project_id);
CREATE INDEX product_memory_project_idx ON public.product_memory (tenant_id, project_id);
--> statement-breakpoint
ALTER TABLE public.brand_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY brand_memory_internal ON public.brand_memory TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY brand_memory_owner ON public.brand_memory TO savoir_runtime
USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = brand_memory.project_id AND p.tenant_id = brand_memory.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = brand_memory.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
)
WITH CHECK (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = brand_memory.project_id AND p.tenant_id = brand_memory.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = brand_memory.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_memory TO savoir_runtime;
--> statement-breakpoint
ALTER TABLE public.product_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY product_memory_internal ON public.product_memory TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY product_memory_owner ON public.product_memory TO savoir_runtime
USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = product_memory.project_id AND p.tenant_id = product_memory.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = product_memory.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
)
WITH CHECK (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = product_memory.project_id AND p.tenant_id = product_memory.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = product_memory.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_memory TO savoir_runtime;
--> statement-breakpoint
