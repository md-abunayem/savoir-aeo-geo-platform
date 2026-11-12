-- Migration 0012: Expand M17 Multi-Engine Adapters (OpenAI, Google AI Overviews, Google AI Mode)

-- Initialize provider state for the three additional engines
INSERT INTO public.monitoring_provider_state(engine, day)
VALUES
  ('openai', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
  ('google_ai_overviews', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
  ('google_ai_mode', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
ON CONFLICT (engine) DO NOTHING;

--> statement-breakpoint
-- Multi-engine run enqueue with distinct item_key per engine
CREATE OR REPLACE FUNCTION public.savoir_monitoring_enqueue(p_tenant uuid, p_project uuid, p_config jsonb, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_account public.monitoring_credits%ROWTYPE;
 v_prompt public.monitoring_prompts%ROWTYPE;
 v_engine text;
 v_collection_method text;
 v_geo text;
 v_language text;
 v_sample integer;
 v_n integer;
 v_total integer;
 v_count integer;
 v_ids jsonb;
BEGIN
 v_engine := p_config->>'engine';
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 160
    OR v_engine NOT IN ('gemini', 'openai', 'google_ai_overviews', 'google_ai_mode')
    OR p_config->>'model' IS NULL THEN
   RAISE EXCEPTION 'INVALID_MONITORING_INPUT';
 END IF;

 v_collection_method := CASE
   WHEN v_engine IN ('google_ai_overviews', 'google_ai_mode') THEN 'licensed_serp'
   ELSE 'official_api'
 END;

 SELECT * INTO v_account FROM public.monitoring_credits WHERE tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('accepted', false, 'reason', 'QUOTA_NOT_CONFIGURED'); END IF;

 SELECT jsonb_agg(id ORDER BY id) INTO v_ids FROM public.monitoring_runs WHERE project_id=p_project AND batch_key=p_key;
 IF v_ids IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.monitoring_runs WHERE project_id=p_project AND batch_key=p_key AND request->>'batchFingerprint' IS DISTINCT FROM md5(p_config::text)) THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('accepted', true, 'duplicate', true, 'runIds', v_ids);
 END IF;

 IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=p_project AND tenant_id=p_tenant AND status='active') THEN
   RETURN jsonb_build_object('accepted', false, 'reason', 'PROJECT_NOT_ACTIVE');
 END IF;

 v_n := (p_config->>'samples')::integer;
 IF v_n IS NULL OR v_n NOT BETWEEN 1 AND 5
    OR jsonb_typeof(p_config->'promptIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_config->'geos') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_config->'languages') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'INVALID_MONITORING_INPUT';
 END IF;

 SELECT count(*) INTO v_count FROM public.monitoring_prompts
 WHERE project_id=p_project AND tenant_id=p_tenant AND active
   AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_config->'promptIds'));

 IF v_count=0 OR v_count<>jsonb_array_length(p_config->'promptIds') THEN
   RETURN jsonb_build_object('accepted', false, 'reason', 'PROMPT_NOT_AVAILABLE');
 END IF;

 v_total := v_count * v_n * jsonb_array_length(p_config->'geos') * jsonb_array_length(p_config->'languages');
 IF v_total NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION 'INVALID_MONITORING_INPUT';
 END IF;

 IF v_account.available < v_total THEN
  IF NOT EXISTS(SELECT 1 FROM public.monitoring_events WHERE project_id=p_project AND kind='quota.exhausted' AND details->>'batchKey'=p_key) THEN
   INSERT INTO public.monitoring_events(tenant_id, project_id, kind, details)
   VALUES(p_tenant, p_project, 'quota.exhausted', jsonb_build_object('batchKey', p_key, 'required', v_total, 'engine', v_engine));
  END IF;
  RETURN jsonb_build_object('accepted', false, 'reason', 'QUOTA_EXHAUSTED');
 END IF;

 UPDATE public.monitoring_credits SET available=available-v_total, reserved=reserved+v_total WHERE tenant_id=p_tenant;

 FOR v_prompt IN SELECT * FROM public.monitoring_prompts WHERE project_id=p_project AND active AND id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_config->'promptIds')) ORDER BY id LOOP
  FOR v_geo IN SELECT value FROM jsonb_array_elements_text(p_config->'geos') LOOP
   FOR v_language IN SELECT value FROM jsonb_array_elements_text(p_config->'languages') LOOP
    FOR v_sample IN 1..v_n LOOP
     INSERT INTO public.monitoring_runs(tenant_id, project_id, batch_key, item_key, request)
     VALUES(
       p_tenant,
       p_project,
       p_key,
       v_prompt.id::text||':'||v_engine||':'||v_geo||':'||v_language||':'||v_sample,
       jsonb_build_object(
         'engine', v_engine,
         'model', p_config->>'model',
         'promptId', v_prompt.id,
         'promptVersion', v_prompt.version,
         'prompt', v_prompt.body,
         'persona', v_prompt.persona,
         'geo', v_geo,
         'language', v_language,
         'sample', v_sample,
         'simulationMethod', 'prompt_context',
         'collectionMethod', v_collection_method,
         'policyVersion', 'monitoring-v1',
         'batchFingerprint', md5(p_config::text)
       )
     );
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;

 INSERT INTO public.monitoring_events(tenant_id, project_id, kind, details)
 VALUES(p_tenant, p_project, 'credits.reserved', jsonb_build_object('batchKey', p_key, 'credits', v_total, 'engine', v_engine));

 SELECT jsonb_agg(id ORDER BY id) INTO v_ids FROM public.monitoring_runs WHERE project_id=p_project AND batch_key=p_key;
 RETURN jsonb_build_object('accepted', true, 'duplicate', false, 'runIds', v_ids);
END $$;

--> statement-breakpoint
-- Multi-engine schedule creation and prompt status handling
CREATE OR REPLACE FUNCTION public.savoir_monitoring_command(p_project uuid, p_action text, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_tenant uuid;
 v_prompt public.monitoring_prompts%ROWTYPE;
 v_schedule public.monitoring_schedules%ROWTYPE;
 v_min integer;
 v_result jsonb;
BEGIN
 v_tenant := public.savoir_monitoring_project(p_project);
 IF p_action='prompt.create' THEN
  IF length(trim(p_data->>'body')) NOT BETWEEN 1 AND 4000 OR length(coalesce(p_data->>'persona',''))>1000 THEN
    RAISE EXCEPTION 'INVALID_PROMPT';
  END IF;
  INSERT INTO public.monitoring_prompts(tenant_id, project_id, body, persona)
  VALUES(v_tenant, p_project, p_data->>'body', coalesce(p_data->>'persona',''))
  RETURNING * INTO v_prompt;
  RETURN to_jsonb(v_prompt);

 ELSIF p_action='prompt.update' THEN
  SELECT * INTO v_prompt FROM public.monitoring_prompts WHERE id=(p_data->>'id')::uuid AND project_id=p_project FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_data ? 'body' AND length(trim(p_data->>'body')) NOT BETWEEN 1 AND 4000 OR p_data ? 'persona' AND length(p_data->>'persona')>1000 THEN
    RAISE EXCEPTION 'INVALID_PROMPT';
  END IF;
  UPDATE public.monitoring_prompts
  SET body=coalesce(p_data->>'body', body),
      persona=coalesce(p_data->>'persona', persona),
      active=coalesce((p_data->>'active')::boolean, active),
      version=version+CASE WHEN p_data ? 'body' OR p_data ? 'persona' THEN 1 ELSE 0 END
  WHERE id=v_prompt.id
  RETURNING * INTO v_prompt;
  RETURN to_jsonb(v_prompt);

 ELSIF p_action='run' THEN
  RETURN public.savoir_monitoring_enqueue(v_tenant, p_project, p_data->'config', p_data->>'key');

 ELSIF p_action='schedule.create' THEN
  SELECT minimum_interval_minutes INTO v_min FROM public.monitoring_credits WHERE tenant_id=v_tenant;
  IF v_min IS NULL OR (p_data->>'intervalMinutes')::integer < v_min THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'SCHEDULE_NOT_ENTITLED');
  END IF;
  IF p_data->>'engine' NOT IN ('gemini', 'openai', 'google_ai_overviews', 'google_ai_mode')
     OR (p_data->>'intervalMinutes')::integer > 43200 THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(p_data->'promptIds') x
    WHERE NOT EXISTS(SELECT 1 FROM public.monitoring_prompts WHERE id=x.value::uuid AND project_id=p_project AND active)
  ) THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'PROMPT_NOT_AVAILABLE');
  END IF;
  INSERT INTO public.monitoring_schedules(tenant_id, project_id, config)
  VALUES(v_tenant, p_project, p_data)
  RETURNING * INTO v_schedule;
  RETURN to_jsonb(v_schedule);

 ELSIF p_action='prompt.schedule.status' THEN
  IF p_data->>'status' IS NULL OR p_data->>'status' NOT IN ('active', 'paused', 'deleted') THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE';
  END IF;
  SELECT * INTO v_prompt FROM public.monitoring_prompts WHERE id=(p_data->>'id')::uuid AND project_id=p_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  v_result := '[]'::jsonb;
  FOR v_schedule IN SELECT * FROM public.monitoring_schedules
   WHERE project_id=p_project AND status<>'deleted' AND config->'promptIds' ? v_prompt.id::text
   ORDER BY id FOR UPDATE LOOP
   v_schedule.config := jsonb_set(
     v_schedule.config,
     '{pausedPromptIds}',
     coalesce(v_schedule.config->'pausedPromptIds', '[]'::jsonb) - v_prompt.id::text
   );
   IF p_data->>'status'='paused' THEN
    v_schedule.config := jsonb_set(
      v_schedule.config,
      '{pausedPromptIds}',
      (v_schedule.config->'pausedPromptIds') || jsonb_build_array(v_prompt.id::text)
    );
   ELSIF p_data->>'status'='deleted' THEN
    v_schedule.config := jsonb_set(
      v_schedule.config,
      '{promptIds}',
      (v_schedule.config->'promptIds') - v_prompt.id::text
    );
    IF jsonb_array_length(v_schedule.config->'promptIds')=0 THEN
      v_schedule.status := 'deleted';
    END IF;
   END IF;
   UPDATE public.monitoring_schedules SET config=v_schedule.config, status=v_schedule.status WHERE id=v_schedule.id;
   v_result := v_result || jsonb_build_array(to_jsonb(v_schedule));
  END LOOP;
  RETURN jsonb_build_object('schedules', v_result);

 ELSIF p_action='schedule.status' THEN
  IF p_data->>'status' NOT IN ('active', 'paused', 'deleted') THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE';
  END IF;
  WITH changed AS (
   UPDATE public.monitoring_schedules
   SET status=p_data->>'status',
       next_run_at=CASE WHEN p_data->>'status'='active' THEN clock_timestamp() ELSE next_run_at END
   WHERE project_id=p_project AND status<>'deleted' AND (NOT(p_data ? 'id') OR id=(p_data->>'id')::uuid)
   RETURNING *
  ) SELECT jsonb_agg(to_jsonb(changed)) INTO v_result FROM changed;
  IF v_result IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('schedules', v_result);
 END IF;

 RAISE EXCEPTION 'INVALID_MONITORING_ACTION';
END $$;

--> statement-breakpoint
-- Multi-engine run claim joining per-engine provider state
CREATE OR REPLACE FUNCTION public.savoir_monitoring_claim(p_daily_limit integer, p_spacing_seconds integer)
RETURNS SETOF public.monitoring_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_run public.monitoring_runs%ROWTYPE;
 v_engine text;
 v_state public.monitoring_provider_state%ROWTYPE;
 v_day text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
 IF p_daily_limit NOT BETWEEN 1 AND 100000 OR p_spacing_seconds NOT BETWEEN 1 AND 3600 THEN
   RAISE EXCEPTION 'INVALID_PROVIDER_BUDGET';
 END IF;

 -- Expired processing leases: mark ambiguous without repeat
 FOR v_run IN
   SELECT * FROM public.monitoring_runs
   WHERE status='processing' AND locked_at < clock_timestamp() - interval '5 minutes'
   ORDER BY locked_at FOR UPDATE SKIP LOCKED LIMIT 100
 LOOP
   PERFORM public.savoir_monitoring_finish(v_run.id, v_run.lease_id, 'uncertain', NULL, 'WORKER_LEASE_EXPIRED', 0);
 END LOOP;

 -- Find the oldest queued run whose engine is currently available
 FOR v_run IN
   SELECT r.* FROM public.monitoring_runs r
   JOIN public.projects p ON p.id = r.project_id
   JOIN public.monitoring_provider_state ps ON ps.engine = coalesce(r.request->>'engine', 'gemini')
   WHERE r.status = 'queued'
     AND r.available_at <= clock_timestamp()
     AND p.status = 'active'
     AND (ps.blocked_until IS NULL OR ps.blocked_until <= clock_timestamp())
     AND ps.next_call_at <= clock_timestamp()
     AND (ps.day <> v_day OR ps.calls_today < p_daily_limit)
   ORDER BY r.available_at, r.id
   FOR UPDATE OF r SKIP LOCKED
   LIMIT 1
 LOOP
   v_engine := coalesce(v_run.request->>'engine', 'gemini');

   -- Lock provider state for this engine
   SELECT * INTO v_state FROM public.monitoring_provider_state WHERE engine = v_engine FOR UPDATE;
   IF NOT FOUND THEN
     CONTINUE;
   END IF;

   IF v_state.day <> v_day THEN
     UPDATE public.monitoring_provider_state SET day = v_day, calls_today = 0 WHERE engine = v_engine;
     v_state.calls_today := 0;
   END IF;

   IF v_state.calls_today >= p_daily_limit
      OR v_state.next_call_at > clock_timestamp()
      OR (v_state.blocked_until IS NOT NULL AND v_state.blocked_until > clock_timestamp()) THEN
     CONTINUE;
   END IF;

   UPDATE public.monitoring_runs
   SET status = 'processing', attempts = attempts + 1, lease_id = gen_random_uuid(), locked_at = clock_timestamp()
   WHERE id = v_run.id
   RETURNING * INTO v_run;

   UPDATE public.monitoring_provider_state
   SET calls_today = calls_today + 1, next_call_at = clock_timestamp() + make_interval(secs => p_spacing_seconds)
   WHERE engine = v_engine;

   RETURN NEXT v_run;
   RETURN;
 END LOOP;

 RETURN;
END $$;

--> statement-breakpoint
-- Multi-engine run finish updating engine-specific provider state and events
CREATE OR REPLACE FUNCTION public.savoir_monitoring_finish(p_id uuid, p_lease uuid, p_status text, p_result jsonb, p_error text, p_delay integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_run public.monitoring_runs%ROWTYPE;
 v_engine text;
 v_previous text;
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('queued','succeeded','refused','failed','uncertain') OR p_delay IS NULL OR p_delay NOT BETWEEN 0 AND 604800 OR length(p_error)>80 THEN
   RAISE EXCEPTION 'INVALID_RUN_COMPLETION';
 END IF;

 SELECT * INTO v_run FROM public.monitoring_runs WHERE id=p_id AND status='processing' AND lease_id=p_lease FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;

 v_engine := coalesce(v_run.request->>'engine', 'gemini');

 IF p_status='queued' AND v_run.attempts>=4 THEN p_status='failed'; END IF;

 IF p_status IN ('succeeded','refused') AND (p_result->>'evidenceKey' IS NULL OR p_result->>'evidenceHash' !~ '^[a-f0-9]{64}$') THEN
   RAISE EXCEPTION 'MISSING_EVIDENCE';
 END IF;

 UPDATE public.monitoring_runs
 SET status=p_status, result=p_result, error_code=p_error, lease_id=NULL, locked_at=NULL,
     available_at=clock_timestamp()+make_interval(secs=>p_delay),
     completed_at=CASE WHEN p_status='queued' THEN NULL ELSE clock_timestamp() END
 WHERE id=p_id;

 IF p_status<>'queued' THEN
  UPDATE public.monitoring_credits
  SET reserved=reserved-1, used=used+CASE WHEN p_status IN ('succeeded','refused') THEN 1 ELSE 0 END,
      available=available+CASE WHEN p_status IN ('failed','uncertain') THEN 1 ELSE 0 END
  WHERE tenant_id=v_run.tenant_id;

  INSERT INTO public.monitoring_events(tenant_id, project_id, kind, details)
  VALUES(v_run.tenant_id, v_run.project_id, CASE WHEN p_status IN ('succeeded','refused') THEN 'run.completed' ELSE 'run.failed' END,
    jsonb_build_object('runId', p_id, 'engine', v_engine, 'status', p_status,
      'creditsCommitted', CASE WHEN p_status IN ('succeeded','refused') THEN 1 ELSE 0 END,
      'creditsReleased', CASE WHEN p_status IN ('failed','uncertain') THEN 1 ELSE 0 END));
 END IF;

 IF p_status IN ('succeeded','refused') THEN
  SELECT last_model INTO v_previous FROM public.monitoring_provider_state WHERE engine=v_engine;
  IF v_previous IS NOT NULL AND v_previous IS DISTINCT FROM p_result->>'modelVersion' THEN
   INSERT INTO public.monitoring_events(tenant_id, project_id, kind, details)
   VALUES(v_run.tenant_id, v_run.project_id, 'engine.model_changed', jsonb_build_object('engine', v_engine, 'previous', v_previous, 'current', p_result->>'modelVersion'));
  END IF;
  UPDATE public.monitoring_provider_state SET failure_since=NULL, last_model=p_result->>'modelVersion' WHERE engine=v_engine;
 ELSIF p_status='queued' THEN
  UPDATE public.monitoring_provider_state
  SET failure_since=coalesce(failure_since, clock_timestamp()), blocked_until=clock_timestamp()+make_interval(secs=>p_delay)
  WHERE engine=v_engine;
  IF EXISTS(SELECT 1 FROM public.monitoring_provider_state WHERE engine=v_engine AND failure_since<clock_timestamp()-interval '1 hour') THEN
   UPDATE public.monitoring_provider_state SET blocked_until=greatest(blocked_until, clock_timestamp()+interval '15 minutes') WHERE engine=v_engine;
   INSERT INTO public.monitoring_events(tenant_id, project_id, kind, details) VALUES(v_run.tenant_id, v_run.project_id, 'engine.degraded', jsonb_build_object('engine', v_engine));
  END IF;
 END IF;

 RETURN true;
END $$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_monitoring_enqueue(uuid, uuid, jsonb, text),
                        public.savoir_monitoring_command(uuid, text, jsonb),
                        public.savoir_monitoring_claim(integer, integer),
                        public.savoir_monitoring_finish(uuid, uuid, text, jsonb, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.savoir_monitoring_command(uuid, text, jsonb),
                          public.savoir_monitoring_claim(integer, integer),
                          public.savoir_monitoring_finish(uuid, uuid, text, jsonb, text, integer) TO savoir_runtime;

