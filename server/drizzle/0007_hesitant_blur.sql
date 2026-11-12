CREATE TABLE "monitoring_credits" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"minimum_interval_minutes" integer DEFAULT 1440 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" varchar(80) NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"body" text NOT NULL,
	"persona" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_provider_state" (
	"engine" varchar(40) PRIMARY KEY NOT NULL,
	"next_call_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone,
	"failure_since" timestamp with time zone,
	"calls_today" integer DEFAULT 0 NOT NULL,
	"day" varchar(10) NOT NULL,
	"last_model" varchar(150)
);
--> statement-breakpoint
CREATE TABLE "monitoring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"batch_key" varchar(160) NOT NULL,
	"item_key" varchar(200) NOT NULL,
	"request" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_id" uuid,
	"locked_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb,
	"error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monitoring_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_credits" ADD CONSTRAINT "monitoring_credits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_prompts" ADD CONSTRAINT "monitoring_prompts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_prompts" ADD CONSTRAINT "monitoring_prompts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_schedules" ADD CONSTRAINT "monitoring_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_schedules" ADD CONSTRAINT "monitoring_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_run_dedupe" ON "monitoring_runs" USING btree ("project_id","batch_key","item_key");--> statement-breakpoint
CREATE INDEX "monitoring_run_due" ON "monitoring_runs" USING btree ("status","available_at");
--> statement-breakpoint
ALTER TABLE public.monitoring_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_prompts FORCE ROW LEVEL SECURITY;
CREATE POLICY monitoring_prompts_internal ON public.monitoring_prompts TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY monitoring_prompts_owner ON public.monitoring_prompts TO savoir_runtime USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=monitoring_prompts.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
GRANT SELECT ON public.monitoring_prompts TO savoir_runtime;

--> statement-breakpoint
ALTER TABLE public.monitoring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY monitoring_schedules_internal ON public.monitoring_schedules TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY monitoring_schedules_owner ON public.monitoring_schedules TO savoir_runtime USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=monitoring_schedules.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
GRANT SELECT ON public.monitoring_schedules TO savoir_runtime;

--> statement-breakpoint
ALTER TABLE public.monitoring_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_credits FORCE ROW LEVEL SECURITY;
CREATE POLICY monitoring_credits_internal ON public.monitoring_credits TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY monitoring_credits_owner ON public.monitoring_credits TO savoir_runtime USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=monitoring_credits.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
GRANT SELECT ON public.monitoring_credits TO savoir_runtime;

--> statement-breakpoint
ALTER TABLE public.monitoring_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY monitoring_runs_internal ON public.monitoring_runs TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY monitoring_runs_owner ON public.monitoring_runs TO savoir_runtime USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=monitoring_runs.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
GRANT SELECT ON public.monitoring_runs TO savoir_runtime;

--> statement-breakpoint
ALTER TABLE public.monitoring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_events FORCE ROW LEVEL SECURITY;
CREATE POLICY monitoring_events_internal ON public.monitoring_events TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY monitoring_events_owner ON public.monitoring_events TO savoir_runtime USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=monitoring_events.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
GRANT SELECT ON public.monitoring_events TO savoir_runtime;

--> statement-breakpoint
ALTER TABLE public.monitoring_provider_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_provider_state FORCE ROW LEVEL SECURITY;
CREATE POLICY monitoring_provider_state_internal ON public.monitoring_provider_state TO CURRENT_USER USING (true) WITH CHECK (true);

--> statement-breakpoint
ALTER TABLE public.monitoring_credits ADD CONSTRAINT monitoring_credit_nonnegative CHECK(available>=0 AND reserved>=0 AND used>=0 AND minimum_interval_minutes>=60);
ALTER TABLE public.monitoring_runs ADD CONSTRAINT monitoring_run_status CHECK(status IN ('queued','processing','succeeded','refused','failed','uncertain'));
ALTER TABLE public.monitoring_schedules ADD CONSTRAINT monitoring_schedule_status CHECK(status IN ('active','paused','quota_paused','deleted'));
INSERT INTO public.monitoring_provider_state(engine,day) VALUES('gemini',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'));
--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_project(p_project uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT p.tenant_id INTO v_tenant FROM public.projects p JOIN public.memberships m ON m.tenant_id=p.tenant_id
 JOIN public.users u ON u.id=m.user_id
 WHERE p.id=p_project AND m.role='owner' AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL
 AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid
 AND p.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid;
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
 RETURN v_tenant;
END $$;
--> statement-breakpoint
-- Internal only: both the API boundary and scheduler call this inside their transaction.
CREATE FUNCTION public.savoir_monitoring_enqueue(p_tenant uuid,p_project uuid,p_config jsonb,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_account public.monitoring_credits%ROWTYPE; v_prompt public.monitoring_prompts%ROWTYPE;
 v_geo text; v_language text; v_sample integer; v_n integer; v_total integer; v_count integer; v_ids jsonb;
BEGIN
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 160 OR p_config->>'engine' IS DISTINCT FROM 'gemini' OR p_config->>'model' IS NULL THEN RAISE EXCEPTION 'INVALID_MONITORING_INPUT'; END IF;
 SELECT * INTO v_account FROM public.monitoring_credits WHERE tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('accepted',false,'reason','QUOTA_NOT_CONFIGURED'); END IF;
 SELECT jsonb_agg(id ORDER BY id) INTO v_ids FROM public.monitoring_runs WHERE project_id=p_project AND batch_key=p_key;
 IF v_ids IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.monitoring_runs WHERE project_id=p_project AND batch_key=p_key AND request->>'batchFingerprint' IS DISTINCT FROM md5(p_config::text)) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('accepted',true,'duplicate',true,'runIds',v_ids);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=p_project AND tenant_id=p_tenant AND status='active') THEN RETURN jsonb_build_object('accepted',false,'reason','PROJECT_NOT_ACTIVE'); END IF;
 v_n=(p_config->>'samples')::integer;
 IF v_n IS NULL OR v_n NOT BETWEEN 1 AND 5 OR jsonb_typeof(p_config->'promptIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p_config->'geos') IS DISTINCT FROM 'array' OR jsonb_typeof(p_config->'languages') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_MONITORING_INPUT'; END IF;
 SELECT count(*) INTO v_count FROM public.monitoring_prompts WHERE project_id=p_project AND tenant_id=p_tenant AND active AND id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_config->'promptIds'));
 IF v_count=0 OR v_count<>jsonb_array_length(p_config->'promptIds') THEN RETURN jsonb_build_object('accepted',false,'reason','PROMPT_NOT_AVAILABLE'); END IF;
 v_total=v_count*v_n*jsonb_array_length(p_config->'geos')*jsonb_array_length(p_config->'languages');
 IF v_total NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_MONITORING_INPUT'; END IF;
 IF v_account.available<v_total THEN
  IF NOT EXISTS(SELECT 1 FROM public.monitoring_events WHERE project_id=p_project AND kind='quota.exhausted' AND details->>'batchKey'=p_key) THEN
   INSERT INTO public.monitoring_events(tenant_id,project_id,kind,details) VALUES(p_tenant,p_project,'quota.exhausted',jsonb_build_object('batchKey',p_key,'required',v_total));
  END IF;
  RETURN jsonb_build_object('accepted',false,'reason','QUOTA_EXHAUSTED');
 END IF;
 UPDATE public.monitoring_credits SET available=available-v_total,reserved=reserved+v_total WHERE tenant_id=p_tenant;
 FOR v_prompt IN SELECT * FROM public.monitoring_prompts WHERE project_id=p_project AND active AND id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_config->'promptIds')) ORDER BY id LOOP
  FOR v_geo IN SELECT value FROM jsonb_array_elements_text(p_config->'geos') LOOP
   FOR v_language IN SELECT value FROM jsonb_array_elements_text(p_config->'languages') LOOP
    FOR v_sample IN 1..v_n LOOP
     INSERT INTO public.monitoring_runs(tenant_id,project_id,batch_key,item_key,request)
     VALUES(p_tenant,p_project,p_key,v_prompt.id::text||':'||v_geo||':'||v_language||':'||v_sample,
       jsonb_build_object('engine','gemini','model',p_config->>'model','promptId',v_prompt.id,'promptVersion',v_prompt.version,'prompt',v_prompt.body,'persona',v_prompt.persona,'geo',v_geo,'language',v_language,'sample',v_sample,'simulationMethod','prompt_context','collectionMethod','official_api','policyVersion','monitoring-v1','batchFingerprint',md5(p_config::text)));
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 INSERT INTO public.monitoring_events(tenant_id,project_id,kind,details) VALUES(p_tenant,p_project,'credits.reserved',jsonb_build_object('batchKey',p_key,'credits',v_total));
 SELECT jsonb_agg(id ORDER BY id) INTO v_ids FROM public.monitoring_runs WHERE project_id=p_project AND batch_key=p_key;
 RETURN jsonb_build_object('accepted',true,'duplicate',false,'runIds',v_ids);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_command(p_project uuid,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid; v_prompt public.monitoring_prompts%ROWTYPE; v_schedule public.monitoring_schedules%ROWTYPE; v_min integer; v_result jsonb;
BEGIN
 v_tenant=public.savoir_monitoring_project(p_project);
 IF p_action='prompt.create' THEN
  IF length(trim(p_data->>'body')) NOT BETWEEN 1 AND 4000 OR length(coalesce(p_data->>'persona',''))>1000 THEN RAISE EXCEPTION 'INVALID_PROMPT'; END IF;
  INSERT INTO public.monitoring_prompts(tenant_id,project_id,body,persona) VALUES(v_tenant,p_project,p_data->>'body',coalesce(p_data->>'persona','')) RETURNING * INTO v_prompt;
  RETURN to_jsonb(v_prompt);
 ELSIF p_action='prompt.update' THEN
  SELECT * INTO v_prompt FROM public.monitoring_prompts WHERE id=(p_data->>'id')::uuid AND project_id=p_project FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_data ? 'body' AND length(trim(p_data->>'body')) NOT BETWEEN 1 AND 4000 OR p_data ? 'persona' AND length(p_data->>'persona')>1000 THEN RAISE EXCEPTION 'INVALID_PROMPT'; END IF;
  UPDATE public.monitoring_prompts SET body=coalesce(p_data->>'body',body),persona=coalesce(p_data->>'persona',persona),active=coalesce((p_data->>'active')::boolean,active),version=version+CASE WHEN p_data ? 'body' OR p_data ? 'persona' THEN 1 ELSE 0 END WHERE id=v_prompt.id RETURNING * INTO v_prompt;
  RETURN to_jsonb(v_prompt);
 ELSIF p_action='run' THEN
  RETURN public.savoir_monitoring_enqueue(v_tenant,p_project,p_data->'config',p_data->>'key');
 ELSIF p_action='schedule.create' THEN
  SELECT minimum_interval_minutes INTO v_min FROM public.monitoring_credits WHERE tenant_id=v_tenant;
  IF v_min IS NULL OR (p_data->>'intervalMinutes')::integer<v_min THEN RETURN jsonb_build_object('accepted',false,'reason','SCHEDULE_NOT_ENTITLED'); END IF;
  IF p_data->>'engine' IS DISTINCT FROM 'gemini' OR (p_data->>'intervalMinutes')::integer>43200 THEN RAISE EXCEPTION 'INVALID_SCHEDULE'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_data->'promptIds') x WHERE NOT EXISTS(SELECT 1 FROM public.monitoring_prompts WHERE id=x.value::uuid AND project_id=p_project AND active)) THEN RETURN jsonb_build_object('accepted',false,'reason','PROMPT_NOT_AVAILABLE'); END IF;
  INSERT INTO public.monitoring_schedules(tenant_id,project_id,config) VALUES(v_tenant,p_project,p_data) RETURNING * INTO v_schedule;
  RETURN to_jsonb(v_schedule);
 ELSIF p_action='schedule.status' THEN
  IF p_data->>'status' NOT IN ('active','paused','deleted') THEN RAISE EXCEPTION 'INVALID_SCHEDULE'; END IF;
  WITH changed AS (
   UPDATE public.monitoring_schedules SET status=p_data->>'status',next_run_at=CASE WHEN p_data->>'status'='active' THEN clock_timestamp() ELSE next_run_at END
   WHERE project_id=p_project AND status<>'deleted' AND (NOT(p_data ? 'id') OR id=(p_data->>'id')::uuid) RETURNING *
  ) SELECT jsonb_agg(to_jsonb(changed)) INTO v_result FROM changed;
  IF v_result IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('schedules',v_result);
 END IF;
 RAISE EXCEPTION 'INVALID_MONITORING_ACTION';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_tick() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_schedule public.monitoring_schedules%ROWTYPE; v_config jsonb; v_result jsonb; v_count integer=0;
BEGIN
 FOR v_schedule IN SELECT s.* FROM public.monitoring_schedules s JOIN public.projects p ON p.id=s.project_id WHERE s.status='active' AND s.next_run_at<=clock_timestamp() AND p.status='active' ORDER BY s.next_run_at FOR UPDATE OF s SKIP LOCKED LIMIT 20 LOOP
  v_config=v_schedule.config;
  -- Pausing a prompt affects future cycles without rewriting history.
  v_config=jsonb_set(v_config,'{promptIds}',coalesce((SELECT jsonb_agg(id::text ORDER BY id) FROM public.monitoring_prompts WHERE project_id=v_schedule.project_id AND active AND id IN(SELECT value::uuid FROM jsonb_array_elements_text(v_config->'promptIds'))),'[]'::jsonb));
  IF jsonb_array_length(v_config->'promptIds')>0 THEN
   v_result=public.savoir_monitoring_enqueue(v_schedule.tenant_id,v_schedule.project_id,v_config,'schedule:'||v_schedule.id||':'||extract(epoch FROM v_schedule.next_run_at)::text);
   IF v_result->>'reason' IN ('QUOTA_EXHAUSTED','QUOTA_NOT_CONFIGURED') THEN UPDATE public.monitoring_schedules SET status='quota_paused' WHERE id=v_schedule.id; END IF;
  END IF;
  -- Skip missed intervals after downtime instead of creating an unbounded catch-up burst.
  UPDATE public.monitoring_schedules SET next_run_at=clock_timestamp()+make_interval(mins=>(v_schedule.config->>'intervalMinutes')::integer) WHERE id=v_schedule.id;
  v_count=v_count+1;
 END LOOP;
 RETURN v_count;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_finish(p_id uuid,p_lease uuid,p_status text,p_result jsonb,p_error text,p_delay integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_run public.monitoring_runs%ROWTYPE; v_previous text;
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('queued','succeeded','refused','failed','uncertain') OR p_delay IS NULL OR p_delay NOT BETWEEN 0 AND 604800 OR length(p_error)>80 THEN RAISE EXCEPTION 'INVALID_RUN_COMPLETION'; END IF;
 SELECT * INTO v_run FROM public.monitoring_runs WHERE id=p_id AND status='processing' AND lease_id=p_lease FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_status='queued' AND v_run.attempts>=4 THEN p_status='failed'; END IF;
 IF p_status IN ('succeeded','refused') AND (p_result->>'evidenceKey' IS NULL OR p_result->>'evidenceHash' !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'MISSING_EVIDENCE'; END IF;
 UPDATE public.monitoring_runs SET status=p_status,result=p_result,error_code=p_error,lease_id=NULL,locked_at=NULL,available_at=clock_timestamp()+make_interval(secs=>p_delay),completed_at=CASE WHEN p_status='queued' THEN NULL ELSE clock_timestamp() END WHERE id=p_id;
 IF p_status<>'queued' THEN
  UPDATE public.monitoring_credits SET reserved=reserved-1,used=used+CASE WHEN p_status IN ('succeeded','refused') THEN 1 ELSE 0 END,available=available+CASE WHEN p_status IN ('failed','uncertain') THEN 1 ELSE 0 END WHERE tenant_id=v_run.tenant_id;
  INSERT INTO public.monitoring_events(tenant_id,project_id,kind,details) VALUES(v_run.tenant_id,v_run.project_id,CASE WHEN p_status IN ('succeeded','refused') THEN 'run.completed' ELSE 'run.failed' END,jsonb_build_object('runId',p_id,'status',p_status,'creditsCommitted',CASE WHEN p_status IN ('succeeded','refused') THEN 1 ELSE 0 END,'creditsReleased',CASE WHEN p_status IN ('failed','uncertain') THEN 1 ELSE 0 END));
 END IF;
 IF p_status IN ('succeeded','refused') THEN
  SELECT last_model INTO v_previous FROM public.monitoring_provider_state WHERE engine='gemini';
  IF v_previous IS NOT NULL AND v_previous IS DISTINCT FROM p_result->>'modelVersion' THEN INSERT INTO public.monitoring_events(tenant_id,project_id,kind,details) VALUES(v_run.tenant_id,v_run.project_id,'engine.model_changed',jsonb_build_object('previous',v_previous,'current',p_result->>'modelVersion')); END IF;
  UPDATE public.monitoring_provider_state SET failure_since=NULL,last_model=p_result->>'modelVersion' WHERE engine='gemini';
 ELSIF p_status='queued' THEN
  UPDATE public.monitoring_provider_state SET failure_since=coalesce(failure_since,clock_timestamp()),blocked_until=clock_timestamp()+make_interval(secs=>p_delay) WHERE engine='gemini';
  IF EXISTS(SELECT 1 FROM public.monitoring_provider_state WHERE engine='gemini' AND failure_since<clock_timestamp()-interval '1 hour') THEN
   UPDATE public.monitoring_provider_state SET blocked_until=greatest(blocked_until,clock_timestamp()+interval '15 minutes') WHERE engine='gemini';
   INSERT INTO public.monitoring_events(tenant_id,project_id,kind,details) VALUES(v_run.tenant_id,v_run.project_id,'engine.degraded',jsonb_build_object('engine','gemini'));
  END IF;
 END IF;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_claim(p_daily_limit integer,p_spacing_seconds integer)
RETURNS SETOF public.monitoring_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_run public.monitoring_runs%ROWTYPE; v_state public.monitoring_provider_state%ROWTYPE; v_day text=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD');
BEGIN
 IF p_daily_limit NOT BETWEEN 1 AND 100000 OR p_spacing_seconds NOT BETWEEN 1 AND 3600 THEN RAISE EXCEPTION 'INVALID_PROVIDER_BUDGET'; END IF;
 -- An expired processing lease is ambiguous: never automatically repeat a potentially paid call.
 FOR v_run IN SELECT * FROM public.monitoring_runs WHERE status='processing' AND locked_at<clock_timestamp()-interval '5 minutes' ORDER BY locked_at FOR UPDATE SKIP LOCKED LIMIT 100 LOOP
  PERFORM public.savoir_monitoring_finish(v_run.id,v_run.lease_id,'uncertain',NULL,'WORKER_LEASE_EXPIRED',0);
 END LOOP;
 SELECT * INTO v_state FROM public.monitoring_provider_state WHERE engine='gemini' FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 IF v_state.day<>v_day THEN UPDATE public.monitoring_provider_state SET day=v_day,calls_today=0 WHERE engine='gemini';v_state.calls_today=0; END IF;
 IF v_state.calls_today>=p_daily_limit OR v_state.next_call_at>clock_timestamp() OR v_state.blocked_until>clock_timestamp() THEN RETURN; END IF;
 SELECT r.* INTO v_run FROM public.monitoring_runs r JOIN public.projects p ON p.id=r.project_id WHERE r.status='queued' AND r.available_at<=clock_timestamp() AND p.status='active' ORDER BY r.available_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.monitoring_runs SET status='processing',attempts=attempts+1,lease_id=gen_random_uuid(),locked_at=clock_timestamp() WHERE id=v_run.id RETURNING * INTO v_run;
 UPDATE public.monitoring_provider_state SET calls_today=calls_today+1,next_call_at=clock_timestamp()+make_interval(secs=>p_spacing_seconds) WHERE engine='gemini';
 RETURN NEXT v_run;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_monitoring_project(uuid),public.savoir_monitoring_enqueue(uuid,uuid,jsonb,text),public.savoir_monitoring_command(uuid,text,jsonb),public.savoir_monitoring_tick(),public.savoir_monitoring_finish(uuid,uuid,text,jsonb,text,integer),public.savoir_monitoring_claim(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_monitoring_command(uuid,text,jsonb),public.savoir_monitoring_tick(),public.savoir_monitoring_finish(uuid,uuid,text,jsonb,text,integer),public.savoir_monitoring_claim(integer,integer) TO savoir_runtime;

--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_alerts() RETURNS TABLE(event_id uuid,user_id uuid,email varchar,kind varchar,project_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH pending AS (
  SELECT e.* FROM public.monitoring_events e WHERE e.kind IN ('quota.exhausted','engine.degraded','engine.model_changed') AND NOT(e.details ? 'notifiedAt') ORDER BY e.created_at FOR UPDATE SKIP LOCKED LIMIT 20
 ) SELECT e.id,u.id,u.email,e.kind,e.project_id FROM pending e JOIN public.memberships m ON m.tenant_id=e.tenant_id AND m.role='owner' JOIN public.users u ON u.id=m.user_id AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL;
$$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_alert_done(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.monitoring_events SET details=details||jsonb_build_object('notifiedAt',clock_timestamp()) WHERE id=p_id AND kind IN ('quota.exhausted','engine.degraded','engine.model_changed');
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_monitoring_alerts(),public.savoir_monitoring_alert_done(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_monitoring_alerts(),public.savoir_monitoring_alert_done(uuid) TO savoir_runtime;
