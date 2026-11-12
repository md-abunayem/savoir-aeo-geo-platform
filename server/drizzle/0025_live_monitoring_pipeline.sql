CREATE OR REPLACE FUNCTION public.savoir_activate_onboarding(
  p_user_id uuid,
  p_brand_name text,
  p_domain text,
  p_description text,
  p_aliases jsonb,
  p_markets jsonb,
  p_region text,
  p_competitors jsonb,
  p_prompts jsonb,
  p_engines jsonb
)
RETURNS TABLE(out_project_id uuid, out_tenant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE
  v_tenant_id uuid;
  v_project_id uuid;
  v_comp record;
  v_prompt record;
  v_prompt_id uuid;
  v_prompt_ids jsonb := '[]'::jsonb;
  v_sched_config jsonb;
  v_engine jsonb;
  v_market jsonb;
BEGIN
  IF p_user_id IS NULL OR p_brand_name IS NULL OR p_domain IS NULL THEN
    RAISE EXCEPTION 'Invalid project activation input';
  END IF;

  -- 1. Check if user already owns an active tenant; if not, create one
  SELECT m.tenant_id INTO v_tenant_id
  FROM public.memberships m
  WHERE m.user_id = p_user_id AND m.role = 'owner'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    INSERT INTO public.tenants(name, region)
    VALUES(trim(p_brand_name) || ' Workspace', coalesce(nullif(trim(p_region), ''), 'us'))
    RETURNING id INTO v_tenant_id;

    INSERT INTO public.memberships(tenant_id, user_id, role)
    VALUES(v_tenant_id, p_user_id, 'owner');
  END IF;

  -- 2. Create the project
  INSERT INTO public.projects(
    tenant_id, brand_name, domain, description, aliases, default_markets, status
  )
  VALUES(
    v_tenant_id,
    trim(p_brand_name),
    lower(trim(p_domain)),
    p_description,
    coalesce(p_aliases, '[]'::jsonb),
    coalesce(p_markets, '[{"country":"US","language":"en"}]'::jsonb),
    'active'
  )
  ON CONFLICT (tenant_id, domain) DO UPDATE
  SET brand_name = EXCLUDED.brand_name,
      description = EXCLUDED.description,
      aliases = EXCLUDED.aliases,
      default_markets = EXCLUDED.default_markets,
      status = 'active'
  RETURNING id INTO v_project_id;

  -- 3. Insert competitors
  IF p_competitors IS NOT NULL AND jsonb_array_length(p_competitors) > 0 THEN
    FOR v_comp IN SELECT * FROM jsonb_to_recordset(p_competitors) AS x(name text, domain text, rationale text)
    LOOP
      IF v_comp.name IS NOT NULL AND v_comp.domain IS NOT NULL THEN
        INSERT INTO public.competitors(tenant_id, project_id, name, domain, rationale, discovered_via)
        VALUES(v_tenant_id, v_project_id, trim(v_comp.name), lower(trim(v_comp.domain)), v_comp.rationale, 'auto-onboarding');
      END IF;
    END LOOP;
  END IF;

  -- 4. Insert seed prompts
  IF p_prompts IS NOT NULL AND jsonb_array_length(p_prompts) > 0 THEN
    FOR v_prompt IN SELECT * FROM jsonb_to_recordset(p_prompts) AS x(text text, persona text)
    LOOP
      IF v_prompt.text IS NOT NULL AND length(trim(v_prompt.text)) > 0 THEN
        INSERT INTO public.monitoring_prompts(tenant_id, project_id, body, persona, version, active)
        VALUES(v_tenant_id, v_project_id, trim(v_prompt.text), coalesce(v_prompt.persona, ''), 1, true)
        RETURNING id INTO v_prompt_id;
        v_prompt_ids := v_prompt_ids || jsonb_build_array(v_prompt_id::text);
      END IF;
    END LOOP;
  END IF;

  -- Each selected, configured engine gets one schedule per market.
  FOR v_engine IN SELECT value FROM jsonb_array_elements(coalesce(p_engines, '[]'::jsonb)) LOOP
    IF jsonb_typeof(v_engine) <> 'object' OR v_engine->>'model' IS NULL
       OR v_engine->>'engine' NOT IN ('gemini','openai','google_ai_overviews','google_ai_mode') THEN
      RAISE EXCEPTION 'INVALID_MONITORING_ENGINE_CONFIG';
    END IF;
    FOR v_market IN SELECT value FROM jsonb_array_elements(p_markets) LOOP
      v_sched_config := jsonb_build_object(
        'engine', v_engine->>'engine', 'model', v_engine->>'model',
        'cadence', 'daily', 'intervalMinutes', 1440, 'samples', 1,
        'promptIds', v_prompt_ids, 'pausedPromptIds', '[]'::jsonb,
        'geos', jsonb_build_array(v_market->>'country'),
        'languages', jsonb_build_array(v_market->>'language')
      );
      INSERT INTO public.monitoring_schedules(tenant_id, project_id, config, status, next_run_at)
      VALUES(v_tenant_id, v_project_id, v_sched_config,
        CASE WHEN coalesce((v_engine->>'enabled')::boolean, false) THEN 'active' ELSE 'paused' END,
        clock_timestamp());
    END LOOP;
  END LOOP;

  -- 6. Setup / ensure initial monitoring credits
  INSERT INTO public.monitoring_credits(tenant_id, available, reserved, used, minimum_interval_minutes)
  VALUES(v_tenant_id, 2000, 0, 0, 1440)
  ON CONFLICT ON CONSTRAINT monitoring_credits_pkey DO NOTHING;

  -- 7. Remove onboarding draft
  DELETE FROM public.onboarding_drafts WHERE user_id = p_user_id;

  -- 8. Log audit events
  INSERT INTO public.auth_events(user_id, event) VALUES(p_user_id, 'project.created');
  INSERT INTO public.auth_events(user_id, event) VALUES(p_user_id, 'project.activated');

  RETURN QUERY SELECT v_project_id, v_tenant_id;
END;
$$;

--> statement-breakpoint
-- Narrow worker entry point: only completed runs are eligible for answer ingestion.
CREATE FUNCTION public.savoir_answer_scope(p_run uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid; v_owner uuid;
BEGIN
  SELECT r.tenant_id, m.user_id INTO v_tenant, v_owner
  FROM public.monitoring_runs r JOIN public.memberships m ON m.tenant_id=r.tenant_id AND m.role='owner'
  WHERE r.id=p_run AND r.status IN ('succeeded','refused') AND r.result IS NOT NULL LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM set_config('app.tenant_id', v_tenant::text, true);
  PERFORM set_config('app.user_id', v_owner::text, true);
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_answer_pending() RETURNS TABLE(id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT r.id FROM public.monitoring_runs r
  WHERE r.status IN ('succeeded','refused') AND r.result IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.answers a WHERE a.run_id=r.id)
  ORDER BY r.completed_at LIMIT 10
$$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_answer_parsed_event(p_run uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  INSERT INTO public.monitoring_events(tenant_id, project_id, kind, details)
  SELECT a.tenant_id, a.project_id, 'answer.parsed', jsonb_build_object('runId',p_run,'answerId',a.id,'engine',a.engine)
  FROM public.answers a WHERE a.run_id=p_run
    AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
    AND NOT EXISTS(SELECT 1 FROM public.monitoring_events e WHERE e.kind='answer.parsed' AND e.details->>'runId'=p_run::text)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_answer_scope(uuid), public.savoir_answer_pending(), public.savoir_answer_parsed_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_answer_scope(uuid), public.savoir_answer_pending(), public.savoir_answer_parsed_event(uuid) TO savoir_runtime;
