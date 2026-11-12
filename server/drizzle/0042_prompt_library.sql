ALTER TABLE public.monitoring_prompts
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_active boolean,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE public.monitoring_prompts SET updated_at=created_at;
--> statement-breakpoint
CREATE TABLE public.monitoring_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  prompt_id uuid NOT NULL REFERENCES public.monitoring_prompts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  body text NOT NULL,
  persona text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX monitoring_prompt_versions_unique
  ON public.monitoring_prompt_versions(prompt_id, version);
--> statement-breakpoint
CREATE INDEX monitoring_prompt_versions_project_idx
  ON public.monitoring_prompt_versions(project_id, prompt_id, version);
--> statement-breakpoint
INSERT INTO public.monitoring_prompt_versions(tenant_id, project_id, prompt_id, version, body, persona, created_at)
SELECT tenant_id, project_id, id, version, body, persona, created_at
FROM public.monitoring_prompts;
--> statement-breakpoint
ALTER TABLE public.monitoring_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_prompt_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY monitoring_prompt_versions_internal ON public.monitoring_prompt_versions TO CURRENT_USER
  USING (true) WITH CHECK (true);
CREATE POLICY monitoring_prompt_versions_owner ON public.monitoring_prompt_versions TO savoir_runtime
  USING (
    tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.tenant_id=monitoring_prompt_versions.tenant_id
        AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid
        AND m.role='owner'
    )
  );
GRANT SELECT ON public.monitoring_prompt_versions TO savoir_runtime;
--> statement-breakpoint
DO $$
DECLARE
  definition text;
  changed text;
BEGIN
  definition := pg_get_functiondef('public.savoir_monitoring_command(uuid,text,jsonb)'::regprocedure);
  changed := replace(definition,
    $old$  INSERT INTO public.monitoring_prompts(tenant_id, project_id, body, persona)
  VALUES(v_tenant, p_project, p_data->>'body', coalesce(p_data->>'persona',''))
  RETURNING * INTO v_prompt;
  RETURN to_jsonb(v_prompt);$old$,
    $new$  IF jsonb_typeof(coalesce(p_data->'tags','[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_data->'tags','[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'INVALID_PROMPT';
  END IF;
  INSERT INTO public.monitoring_prompts(tenant_id, project_id, body, persona, tags)
  VALUES(v_tenant, p_project, p_data->>'body', coalesce(p_data->>'persona',''),
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_data->'tags','[]'::jsonb))))
  RETURNING * INTO v_prompt;
  INSERT INTO public.monitoring_prompt_versions(tenant_id,project_id,prompt_id,version,body,persona)
  VALUES(v_tenant,p_project,v_prompt.id,v_prompt.version,v_prompt.body,v_prompt.persona);
  RETURN to_jsonb(v_prompt);$new$);
  IF changed = definition THEN
    RAISE EXCEPTION 'Expected prompt creation block was not found';
  END IF;
  definition := changed;

  changed := replace(definition,
    $old$  UPDATE public.monitoring_prompts
  SET body=coalesce(p_data->>'body', body),
      persona=coalesce(p_data->>'persona', persona),
      active=coalesce((p_data->>'active')::boolean, active),
      version=version+CASE WHEN p_data ? 'body' OR p_data ? 'persona' THEN 1 ELSE 0 END
  WHERE id=v_prompt.id
  RETURNING * INTO v_prompt;
  RETURN to_jsonb(v_prompt);$old$,
    $new$  IF p_data ? 'tags' AND (
    jsonb_typeof(p_data->'tags') <> 'array' OR jsonb_array_length(p_data->'tags') > 10
  ) THEN
    RAISE EXCEPTION 'INVALID_PROMPT';
  END IF;
  UPDATE public.monitoring_prompts
  SET body=coalesce(p_data->>'body', body),
      persona=coalesce(p_data->>'persona', persona),
      tags=CASE WHEN p_data ? 'tags'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_data->'tags')) ELSE tags END,
      active=coalesce((p_data->>'active')::boolean, active),
      version=version+CASE WHEN p_data ? 'body' OR p_data ? 'persona' THEN 1 ELSE 0 END,
      updated_at=clock_timestamp()
  WHERE id=v_prompt.id
  RETURNING * INTO v_prompt;
  IF p_data ? 'body' OR p_data ? 'persona' THEN
    INSERT INTO public.monitoring_prompt_versions(tenant_id,project_id,prompt_id,version,body,persona)
    VALUES(v_prompt.tenant_id,v_prompt.project_id,v_prompt.id,v_prompt.version,v_prompt.body,v_prompt.persona);
  END IF;
  RETURN to_jsonb(v_prompt);$new$);
  IF changed = definition THEN
    RAISE EXCEPTION 'Expected prompt update block was not found';
  END IF;
  definition := changed;

  changed := replace(definition,
    $old$ ELSIF p_action='run' THEN$old$,
    $new$ ELSIF p_action='prompt.import' THEN
  IF jsonb_typeof(p_data->'prompts') <> 'array' OR jsonb_array_length(p_data->'prompts') NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'INVALID_PROMPT';
  END IF;
  v_result := '[]'::jsonb;
  v_min := 0;
  FOR v_prompt_input IN SELECT value FROM jsonb_array_elements(p_data->'prompts')
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.monitoring_prompts
      WHERE project_id=p_project AND lower(trim(body))=lower(trim(v_prompt_input->>'body'))
        AND archived_at IS NULL
    ) THEN
      v_min := v_min + 1;
    ELSE
      v_result := v_result || jsonb_build_array(public.savoir_monitoring_command(
        p_project, 'prompt.create',
        jsonb_build_object('body',v_prompt_input->>'body','persona',coalesce(v_prompt_input->>'persona',''),'tags',coalesce(v_prompt_input->'tags','[]'::jsonb))
      ));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created',jsonb_array_length(v_result),'skipped',v_min,'prompts',v_result);

 ELSIF p_action='prompt.bulk' THEN
  IF p_data->>'action' NOT IN ('pause','resume','archive','restore','add-tag')
     OR jsonb_typeof(p_data->'promptIds') <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PROMPT';
  END IF;
  IF p_data->>'action'='add-tag' AND length(trim(p_data->>'tag')) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'INVALID_PROMPT';
  END IF;
  v_result := '[]'::jsonb;
  v_min := 0;
  FOR v_prompt_input IN SELECT to_jsonb(value) FROM jsonb_array_elements_text(p_data->'promptIds')
  LOOP
    SELECT * INTO v_prompt
    FROM public.monitoring_prompts
    WHERE id=(v_prompt_input #>> '{}')::uuid AND project_id=p_project
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF p_data->>'action' IN ('pause','resume') THEN
      PERFORM public.savoir_monitoring_command(
        p_project,'prompt.update',
        jsonb_build_object('id',v_prompt.id,'active',p_data->>'action'='resume')
      );
      SELECT * INTO v_prompt FROM public.monitoring_prompts WHERE id=v_prompt.id;
    ELSIF p_data->>'action'='archive' THEN
      UPDATE public.monitoring_prompts
      SET archived_active=CASE WHEN archived_at IS NULL THEN active ELSE archived_active END,
          archived_at=coalesce(archived_at,clock_timestamp()), active=false, updated_at=clock_timestamp()
      WHERE id=v_prompt.id RETURNING * INTO v_prompt;
    ELSIF p_data->>'action'='restore' THEN
      UPDATE public.monitoring_prompts
      SET active=coalesce(archived_active,false), archived_active=NULL,
          archived_at=NULL, updated_at=clock_timestamp()
      WHERE id=v_prompt.id AND archived_at IS NOT NULL RETURNING * INTO v_prompt;
    ELSE
      UPDATE public.monitoring_prompts
      SET tags=ARRAY(SELECT DISTINCT tag FROM unnest(tags || ARRAY[trim(p_data->>'tag')]) AS tag),
          updated_at=clock_timestamp()
      WHERE id=v_prompt.id RETURNING * INTO v_prompt;
    END IF;
    v_result := v_result || jsonb_build_array(to_jsonb(v_prompt));
  END LOOP;
  RETURN jsonb_build_object('updated',v_result);

 ELSIF p_action='run' THEN $new$);
  IF changed = definition THEN
    RAISE EXCEPTION 'Expected monitoring run branch was not found';
  END IF;
  definition := changed;

  changed := replace(definition,
    $old$ v_result jsonb;$old$,
    $new$ v_result jsonb;
 v_prompt_input jsonb;$new$);
  IF changed = definition THEN
    RAISE EXCEPTION 'Expected monitoring result declaration was not found';
  END IF;
  EXECUTE changed;
END $$; --