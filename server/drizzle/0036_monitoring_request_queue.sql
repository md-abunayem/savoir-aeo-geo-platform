-- Targeted claims retain the existing credit, provider-budget and lease rules.
DO $$
DECLARE original text; expanded text;
BEGIN
  original := pg_get_functiondef('public.savoir_monitoring_claim(integer,integer)'::regprocedure);
  expanded := replace(original,'FUNCTION public.savoir_monitoring_claim(',
    'FUNCTION public.savoir_monitoring_claim_run(p_run uuid, p_engine text, ');
  IF expanded=original OR position('WHERE r.status = ''queued''' IN expanded)=0 THEN
    RAISE EXCEPTION 'Expected monitoring claim implementation not found';
  END IF;
  expanded := replace(expanded,'WHERE r.status = ''queued''',
    'WHERE r.id=p_run AND coalesce(r.request->>''engine'',''gemini'')=p_engine AND r.status = ''queued''');
  EXECUTE expanded;
END $$;
REVOKE ALL ON FUNCTION public.savoir_monitoring_claim_run(uuid,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_monitoring_claim_run(uuid,text,integer,integer) TO savoir_runtime;
--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_dispatch(p_daily_limit integer,p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid,engine text,attempts integer,due_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE expired record;
BEGIN
  IF p_limit IS NULL OR p_daily_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 OR p_daily_limit NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'INVALID_DISPATCH_LIMIT'; END IF;
  -- A crashed request with an ambiguous provider outcome must never be replayed.
  FOR expired IN SELECT r.id,r.lease_id FROM public.monitoring_runs r
    WHERE r.status='processing' AND r.locked_at<clock_timestamp()-interval '5 minutes'
    FOR UPDATE SKIP LOCKED LIMIT 100
  LOOP
    PERFORM public.savoir_monitoring_finish(expired.id,expired.lease_id,'uncertain',NULL,'WORKER_LEASE_EXPIRED',0);
  END LOOP;
  RETURN QUERY SELECT r.id,coalesce(r.request->>'engine','gemini'),r.attempts,
    greatest(r.available_at,ps.next_call_at,coalesce(ps.blocked_until,r.available_at),
      CASE WHEN ps.day=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') AND ps.calls_today>=p_daily_limit
        THEN (date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC'
        ELSE r.available_at END) AS ready
    FROM public.monitoring_runs r JOIN public.projects p ON p.id=r.project_id
    JOIN public.monitoring_provider_state ps ON ps.engine=coalesce(r.request->>'engine','gemini')
    WHERE r.status='queued' AND p.status='active'
    ORDER BY ready,r.created_at,r.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.savoir_monitoring_dispatch(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_monitoring_dispatch(integer,integer) TO savoir_runtime;
--> statement-breakpoint
CREATE FUNCTION public.savoir_monitoring_preflight_result(p_id uuid,p_engine text,p_error text,p_delay integer)
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
  IF p_delay>0 THEN
    UPDATE public.monitoring_runs SET error_code=p_error,available_at=clock_timestamp()+make_interval(secs=>p_delay) WHERE id=p_id;
    RETURN true;
  END IF;
  v_lease:=gen_random_uuid();
  UPDATE public.monitoring_runs SET status='processing',lease_id=v_lease,locked_at=clock_timestamp() WHERE id=p_id;
  RETURN public.savoir_monitoring_finish(p_id,v_lease,'failed',NULL,p_error,0);
END $$;
REVOKE ALL ON FUNCTION public.savoir_monitoring_preflight_result(uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_monitoring_preflight_result(uuid,text,text,integer) TO savoir_runtime;
