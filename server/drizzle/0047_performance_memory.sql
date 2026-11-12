CREATE TABLE public.performance_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES public.publishing_deliveries(id) ON DELETE SET NULL,
  draft_id uuid REFERENCES public.studio_drafts(id) ON DELETE SET NULL,
  platform text NOT NULL,
  channel_id text NOT NULL,
  remote_post_id text,
  topic_cluster varchar(255) NOT NULL,
  asset_format varchar(100) NOT NULL,
  hook_style varchar(100) NOT NULL,
  hook_text text NOT NULL,
  audience_intent varchar(50) DEFAULT 'awareness' NOT NULL,
  impressions integer DEFAULT 0 NOT NULL,
  reach integer DEFAULT 0 NOT NULL,
  likes integer DEFAULT 0 NOT NULL,
  shares integer DEFAULT 0 NOT NULL,
  comments integer DEFAULT 0 NOT NULL,
  clicks integer DEFAULT 0 NOT NULL,
  conversions integer DEFAULT 0 NOT NULL,
  engagement_count integer DEFAULT 0 NOT NULL,
  engagement_rate numeric(7, 4) DEFAULT '0.0000' NOT NULL,
  conversion_tag varchar(100),
  performance_score numeric(6, 2) DEFAULT '0.00' NOT NULL,
  is_top_performer boolean DEFAULT false NOT NULL,
  winning_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
  published_at timestamptz,
  synced_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX performance_memory_tenant_project_idx ON public.performance_memory (tenant_id, project_id);
CREATE INDEX performance_memory_cluster_score_idx ON public.performance_memory (project_id, topic_cluster, performance_score);
CREATE INDEX performance_memory_top_performer_idx ON public.performance_memory (project_id, topic_cluster, is_top_performer);
CREATE UNIQUE INDEX performance_memory_remote_post_unique ON public.performance_memory (project_id, platform, remote_post_id);
--> statement-breakpoint
ALTER TABLE public.performance_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY performance_memory_internal ON public.performance_memory TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY performance_memory_owner ON public.performance_memory TO savoir_runtime
USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = performance_memory.project_id AND p.tenant_id = performance_memory.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = performance_memory.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
)
WITH CHECK (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = performance_memory.project_id AND p.tenant_id = performance_memory.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = performance_memory.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_memory TO savoir_runtime;
