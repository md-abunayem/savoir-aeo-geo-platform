CREATE TABLE public.monitoring_prompt_requests (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  input jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, request_key)
);
--> statement-breakpoint
ALTER TABLE public.monitoring_prompt_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_prompt_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY prompt_requests_internal ON public.monitoring_prompt_requests TO CURRENT_USER
USING (true) WITH CHECK (true);
CREATE POLICY prompt_requests_owner ON public.monitoring_prompt_requests TO savoir_runtime
USING (
  tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid
  AND user_id = nullif(current_setting('app.user_id',true),'')::uuid
  AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id=monitoring_prompt_requests.project_id AND p.tenant_id=monitoring_prompt_requests.tenant_id)
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id=monitoring_prompt_requests.tenant_id AND m.user_id=monitoring_prompt_requests.user_id AND m.role='owner')
);
GRANT SELECT, INSERT ON public.monitoring_prompt_requests TO savoir_runtime;
