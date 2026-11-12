ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'paused';
--> statement-breakpoint
CREATE TABLE public.project_creation_requests (
 user_id uuid NOT NULL REFERENCES public.users(id), request_key text NOT NULL,
 fingerprint text NOT NULL, project_id uuid NOT NULL REFERENCES public.projects(id),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_key)
);
ALTER TABLE public.project_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_creation_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY project_creation_internal ON public.project_creation_requests TO CURRENT_USER USING(true) WITH CHECK(true);
--> statement-breakpoint
CREATE FUNCTION public.savoir_project_context(p_user uuid,p_project uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p.tenant_id FROM public.projects p JOIN public.memberships m ON m.tenant_id=p.tenant_id
 JOIN public.users u ON u.id=m.user_id
 WHERE p.id=p_project AND m.user_id=p_user AND m.role='owner' AND u.disabled_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.savoir_project_context(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_project_context(uuid,uuid) TO savoir_runtime;
--> statement-breakpoint
CREATE FUNCTION public.savoir_create_project(p_user uuid,p_key text,p_fingerprint text,p_data jsonb)
RETURNS TABLE(project_id uuid,tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior public.project_creation_requests%ROWTYPE; result record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND disabled_at IS NULL) THEN RAISE EXCEPTION 'INVALID_OWNER'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,72));
 SELECT * INTO prior FROM public.project_creation_requests r WHERE r.user_id=p_user AND r.request_key=p_key;
 IF FOUND THEN
   IF prior.fingerprint<>p_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   RETURN QUERY SELECT prior.project_id,prior.tenant_id; RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.projects p JOIN public.memberships m ON m.tenant_id=p.tenant_id WHERE m.user_id=p_user AND m.role='owner' AND p.domain=p_data->>'domain') THEN
   RAISE EXCEPTION 'PROJECT_DOMAIN_EXISTS';
 END IF;
 SELECT * INTO result FROM public.savoir_activate_onboarding(p_user,p_data->>'brandName',p_data->>'domain',p_data->>'description',p_data->'aliases',p_data->'markets',p_data->>'region',p_data->'competitors',p_data->'prompts','[]'::jsonb);
 INSERT INTO public.project_creation_requests(user_id,request_key,fingerprint,project_id,tenant_id)
 VALUES(p_user,p_key,p_fingerprint,result.out_project_id,result.out_tenant_id);
 RETURN QUERY SELECT result.out_project_id,result.out_tenant_id;
END $$;
REVOKE ALL ON FUNCTION public.savoir_create_project(uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_create_project(uuid,text,text,jsonb) TO savoir_runtime;
--> statement-breakpoint
CREATE TABLE public.project_launch_requests (
 project_id uuid NOT NULL REFERENCES public.projects(id), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 request_key text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id,request_key)
);
ALTER TABLE public.project_launch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_launch_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY project_launch_internal ON public.project_launch_requests TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY project_launch_owner ON public.project_launch_requests TO savoir_runtime
USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=project_launch_requests.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
GRANT SELECT,INSERT,UPDATE ON public.project_launch_requests TO savoir_runtime;
GRANT UPDATE ON public.monitoring_schedules TO savoir_runtime;
--> statement-breakpoint
ALTER TABLE public.technical_audits ADD COLUMN request_key text;
CREATE UNIQUE INDEX technical_audit_request_key ON public.technical_audits(project_id,request_key);
