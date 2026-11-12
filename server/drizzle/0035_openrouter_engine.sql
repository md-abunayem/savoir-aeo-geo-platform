INSERT INTO public.monitoring_provider_state(engine,day)
VALUES('openrouter',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')) ON CONFLICT(engine) DO NOTHING;
--> statement-breakpoint
-- Preserve the current authorization, credit, and scheduling implementations;
-- extend only their engine allowlists and the collection-method provenance.
DO $$
DECLARE signature text; definition text; expanded text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.savoir_monitoring_enqueue(uuid,uuid,jsonb,text)',
    'public.savoir_monitoring_command(uuid,text,jsonb)',
    'public.savoir_activate_onboarding(uuid,text,text,text,jsonb,jsonb,text,jsonb,jsonb,jsonb)'
  ] LOOP
    definition := pg_get_functiondef(signature::regprocedure);
    expanded := replace(definition,
      '''gemini'', ''openai'', ''google_ai_overviews'', ''google_ai_mode''',
      '''gemini'', ''openai'', ''google_ai_overviews'', ''google_ai_mode'', ''openrouter''');
    expanded := replace(expanded,
      '''gemini'',''openai'',''google_ai_overviews'',''google_ai_mode''',
      '''gemini'',''openai'',''google_ai_overviews'',''google_ai_mode'',''openrouter''');
    IF expanded = definition THEN RAISE EXCEPTION 'Expected monitoring engine allowlist not found in %',signature; END IF;
    expanded := replace(expanded,
      'WHEN v_engine IN (''google_ai_overviews'', ''google_ai_mode'') THEN ''licensed_serp''',
      'WHEN v_engine = ''openrouter'' THEN ''aggregator_api'' WHEN v_engine IN (''google_ai_overviews'', ''google_ai_mode'') THEN ''licensed_serp''');
    EXECUTE expanded;
  END LOOP;
END $$;
