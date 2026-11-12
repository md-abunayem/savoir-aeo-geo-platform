-- Explicit owner action for legacy queued 429s whose retry timing was not known.
CREATE FUNCTION public.savoir_monitoring_stop_quota_retries(p_project uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid; v_run record; v_lease uuid; v_count integer := 0;
BEGIN
  v_tenant := public.savoir_monitoring_project(p_project);
  FOR v_run IN SELECT id FROM public.monitoring_runs
    WHERE project_id=p_project AND tenant_id=v_tenant AND status='queued'
      AND error_code IN ('PROVIDER_RATE_LIMITED','PROVIDER_QUOTA_REVIEW_REQUIRED')
    FOR UPDATE SKIP LOCKED
  LOOP
    v_lease := gen_random_uuid();
    UPDATE public.monitoring_runs SET status='processing',lease_id=v_lease,locked_at=clock_timestamp()
      WHERE id=v_run.id;
    -- Use the existing settlement path; do not increment attempts or call a provider.
    PERFORM public.savoir_monitoring_finish(v_run.id,v_lease,'failed',NULL,'PROVIDER_QUOTA_REVIEW_REQUIRED',0);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.savoir_monitoring_stop_quota_retries(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_monitoring_stop_quota_retries(uuid) TO savoir_runtime;
