-- MON-FR-008: prompt controls within shared schedules.
CREATE OR REPLACE FUNCTION public.savoir_monitoring_command(p_project uuid,p_action text,p_data jsonb)
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
 ELSIF p_action='prompt.schedule.status' THEN
  IF p_data->>'status' IS NULL OR p_data->>'status' NOT IN ('active','paused','deleted') THEN RAISE EXCEPTION 'INVALID_SCHEDULE'; END IF;
  SELECT * INTO v_prompt FROM public.monitoring_prompts WHERE id=(p_data->>'id')::uuid AND project_id=p_project;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  v_result='[]'::jsonb;
  -- Serialize with scheduler ticks; already reserved runs retain their snapshots.
  FOR v_schedule IN SELECT * FROM public.monitoring_schedules
   WHERE project_id=p_project AND status<>'deleted' AND config->'promptIds' ? v_prompt.id::text
   ORDER BY id FOR UPDATE LOOP
   v_schedule.config=jsonb_set(v_schedule.config,'{pausedPromptIds}',
    coalesce(v_schedule.config->'pausedPromptIds','[]'::jsonb)-v_prompt.id::text);
   IF p_data->>'status'='paused' THEN
    v_schedule.config=jsonb_set(v_schedule.config,'{pausedPromptIds}',
     (v_schedule.config->'pausedPromptIds')||jsonb_build_array(v_prompt.id::text));
   ELSIF p_data->>'status'='deleted' THEN
    v_schedule.config=jsonb_set(v_schedule.config,'{promptIds}',(v_schedule.config->'promptIds')-v_prompt.id::text);
    IF jsonb_array_length(v_schedule.config->'promptIds')=0 THEN v_schedule.status='deleted'; END IF;
   END IF;
   UPDATE public.monitoring_schedules SET config=v_schedule.config,status=v_schedule.status WHERE id=v_schedule.id;
   v_result=v_result||jsonb_build_array(to_jsonb(v_schedule));
  END LOOP;
  RETURN jsonb_build_object('schedules',v_result);
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
CREATE OR REPLACE FUNCTION public.savoir_monitoring_tick() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_schedule public.monitoring_schedules%ROWTYPE; v_config jsonb; v_result jsonb; v_count integer=0;
BEGIN
 FOR v_schedule IN SELECT s.* FROM public.monitoring_schedules s JOIN public.projects p ON p.id=s.project_id WHERE s.status='active' AND s.next_run_at<=clock_timestamp() AND p.status='active' ORDER BY s.next_run_at FOR UPDATE OF s SKIP LOCKED LIMIT 20 LOOP
  v_config=v_schedule.config;
  -- Pausing a prompt affects future cycles without rewriting history.
  v_config=jsonb_set(v_config,'{promptIds}',coalesce((SELECT jsonb_agg(id::text ORDER BY id) FROM public.monitoring_prompts WHERE project_id=v_schedule.project_id AND active AND NOT(coalesce(v_config->'pausedPromptIds','[]'::jsonb) ? id::text) AND id IN(SELECT value::uuid FROM jsonb_array_elements_text(v_config->'promptIds'))),'[]'::jsonb));
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
