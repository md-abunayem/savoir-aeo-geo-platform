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

 -- Preserve failure metadata for every path, including preflight and crash recovery.
 IF p_status IN ('queued','failed','uncertain') AND p_result IS NULL THEN
   p_result := jsonb_build_object('failure',jsonb_build_object(
     'provider',v_engine,'model',v_run.request->>'model','code',p_error,
     'category',CASE WHEN p_error IN ('PROVIDER_HTTP_401','PROVIDER_API_KEY_INVALID','PROVIDER_AUTH_TOKEN_UNSUPPORTED') THEN 'AUTHENTICATION_ERROR'
       WHEN p_error IN ('PROVIDER_HTTP_403','PROVIDER_API_KEY_RESTRICTED') THEN 'PERMISSION_DENIED'
       WHEN p_error='INVALID_MODEL' THEN 'MODEL_UNAVAILABLE'
       WHEN p_error='ENGINE_NOT_CONFIGURED' THEN 'PROVIDER_CONFIGURATION_ERROR'
       WHEN p_error IN ('WORKER_LEASE_EXPIRED','EVIDENCE_WRITE_UNCERTAIN') THEN 'WORKER_INFRASTRUCTURE_ERROR'
       ELSE 'PROVIDER_UNAVAILABLE' END,
     'message','Check the recorded error code and monitoring recovery instructions.',
     'httpStatus',CASE WHEN p_error ~ '^PROVIDER_HTTP_[0-9]{3}$' THEN right(p_error,3)::integer ELSE NULL END,
     'preflightAttempts',coalesce((v_run.result->>'preflightAttempts')::integer,0)+CASE WHEN p_error='PROVIDER_PREFLIGHT_UNAVAILABLE' THEN 1 ELSE 0 END,
     'retryable',p_status='queued','attempts',v_run.attempts,'retryAttempts',greatest(0,v_run.attempts-1),
     'timestamp',clock_timestamp(),'status',p_status));
 END IF;
 -- Only the originating active schedule is automatically paused. Manual pauses are untouched.
 -- No guessed reset time or automatic probe can restart an exhausted quota.
 IF p_status='failed' AND p_error IN ('PROVIDER_QUOTA_UNAVAILABLE','PROVIDER_GROUNDING_QUOTA_EXHAUSTED','PROVIDER_DAILY_QUOTA_EXHAUSTED','PROVIDER_HTTP_402') THEN
   UPDATE public.monitoring_schedules SET status='quota_paused',
     config=config || jsonb_build_object('pauseReason',p_error,'pausedBy','provider_quota')
   WHERE project_id=v_run.project_id AND status='active'
     AND v_run.batch_key LIKE 'schedule:' || id::text || ':%';
 END IF;

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
CREATE OR REPLACE FUNCTION public.savoir_monitoring_preflight_result(p_id uuid,p_engine text,p_error text,p_delay integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_run public.monitoring_runs%ROWTYPE; v_lease uuid;
BEGIN
  IF p_error IS NULL OR p_delay IS NULL OR p_delay NOT BETWEEN 0 AND 3600
    OR (p_delay>0 AND p_error<>'PROVIDER_PREFLIGHT_UNAVAILABLE')
    OR (p_delay=0 AND p_error NOT IN ('ENGINE_NOT_CONFIGURED','PROVIDER_HTTP_401','PROVIDER_HTTP_403',
      'PROVIDER_AUTH_TOKEN_UNSUPPORTED','PROVIDER_API_KEY_INVALID','PROVIDER_API_KEY_RESTRICTED','INVALID_MODEL')) THEN
    RAISE EXCEPTION 'INVALID_PREFLIGHT_RESULT';
  END IF;
  SELECT * INTO v_run FROM public.monitoring_runs WHERE id=p_id AND status='queued'
    AND coalesce(request->>'engine','gemini')=p_engine FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_run.error_code='PROVIDER_PREFLIGHT_UNAVAILABLE' AND v_run.available_at>clock_timestamp() THEN RETURN false; END IF;
  IF p_delay>0 AND coalesce((v_run.result->>'preflightAttempts')::integer,0)<3 THEN
    UPDATE public.monitoring_runs SET result=jsonb_build_object('preflightAttempts',coalesce((v_run.result->>'preflightAttempts')::integer,0)+1),error_code=p_error,available_at=clock_timestamp()+make_interval(secs=>p_delay) WHERE id=p_id;
    RETURN true;
  END IF;
  v_lease:=gen_random_uuid();
  UPDATE public.monitoring_runs SET status='processing',lease_id=v_lease,locked_at=clock_timestamp() WHERE id=p_id;
  RETURN public.savoir_monitoring_finish(p_id,v_lease,'failed',NULL,p_error,0);
END $$;
REVOKE ALL ON FUNCTION public.savoir_monitoring_preflight_result(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_monitoring_preflight_result(uuid,text,text,integer) TO savoir_runtime;

