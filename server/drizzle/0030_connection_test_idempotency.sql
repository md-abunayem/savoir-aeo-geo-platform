CREATE TABLE public.monitoring_connection_tests (
 project_id uuid NOT NULL REFERENCES public.projects(id),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 request_key text NOT NULL,
 engine text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,request_key)
);
ALTER TABLE public.monitoring_connection_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_connection_tests FORCE ROW LEVEL SECURITY;
CREATE POLICY connection_test_internal ON public.monitoring_connection_tests TO CURRENT_USER
USING(true) WITH CHECK(true);
CREATE POLICY connection_test_owner ON public.monitoring_connection_tests TO savoir_runtime
USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM public.projects p WHERE p.id=monitoring_connection_tests.project_id AND p.tenant_id=monitoring_connection_tests.tenant_id)
 AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=monitoring_connection_tests.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner')
);
GRANT SELECT,INSERT,UPDATE ON public.monitoring_connection_tests TO savoir_runtime;
