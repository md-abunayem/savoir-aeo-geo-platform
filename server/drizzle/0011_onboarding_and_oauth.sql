-- 1. OAuth accounts table
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" varchar(30) NOT NULL,
  "provider_user_id" varchar(255) NOT NULL,
  "email" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_accounts_provider_uid_unique" UNIQUE("provider", "provider_user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_accounts_user_idx" ON "oauth_accounts" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "oauth_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY oauth_accounts_policy ON "oauth_accounts" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 2. Onboarding drafts table
CREATE TABLE IF NOT EXISTS "onboarding_drafts" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "step" integer DEFAULT 1 NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_drafts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY onboarding_drafts_policy ON "onboarding_drafts" TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 3. Competitors table
CREATE TABLE IF NOT EXISTS "competitors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(150) NOT NULL,
  "domain" text NOT NULL,
  "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rationale" text,
  "discovered_via" varchar(50) DEFAULT 'manual' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitors_project_idx" ON "competitors" USING btree ("project_id");
--> statement-breakpoint
ALTER TABLE "competitors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "competitors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY competitor_tenant ON "competitors" TO savoir_runtime
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- 4. Projects table additions (metadata columns)
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "default_markets" jsonb DEFAULT '[{"country":"US","language":"en"}]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "timezone" varchar(64) DEFAULT 'UTC' NOT NULL;
--> statement-breakpoint

-- 5. Stored function: savoir_oauth_login_or_link
CREATE OR REPLACE FUNCTION public.savoir_oauth_login_or_link(
  p_provider text,
  p_provider_user_id text,
  p_email text,
  p_name text
)
RETURNS TABLE(user_id uuid, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE
  v_user_id uuid;
  v_is_new boolean := false;
BEGIN
  IF p_provider IS NULL OR p_provider_user_id IS NULL OR p_email IS NULL THEN
    RAISE EXCEPTION 'Invalid oauth input';
  END IF;

  -- 1. Check if OAuth account is already linked
  SELECT oa.user_id INTO v_user_id
  FROM public.oauth_accounts oa
  WHERE oa.provider = p_provider AND oa.provider_user_id = p_provider_user_id;

  IF v_user_id IS NOT NULL THEN
    UPDATE public.users SET email_verified_at = coalesce(email_verified_at, clock_timestamp()), updated_at = clock_timestamp()
    WHERE id = v_user_id;
    RETURN QUERY SELECT v_user_id, false;
    RETURN;
  END IF;

  -- 2. Check if a user exists with this email
  SELECT u.id INTO v_user_id FROM public.users u WHERE lower(u.email) = lower(p_email);

  IF v_user_id IS NULL THEN
    v_is_new := true;
    INSERT INTO public.users(name, email, email_verified_at)
    VALUES(trim(coalesce(p_name, split_part(p_email, '@', 1))), lower(p_email), clock_timestamp())
    RETURNING id INTO v_user_id;

    INSERT INTO public.auth_events(user_id, event) VALUES(v_user_id, 'account.registered');
  ELSE
    UPDATE public.users SET email_verified_at = coalesce(email_verified_at, clock_timestamp()), updated_at = clock_timestamp()
    WHERE id = v_user_id;
  END IF;

  -- 3. Link OAuth account
  INSERT INTO public.oauth_accounts(user_id, provider, provider_user_id, email)
  VALUES(v_user_id, p_provider, p_provider_user_id, lower(p_email))
  ON CONFLICT (provider, provider_user_id) DO UPDATE SET email = EXCLUDED.email;

  INSERT INTO public.auth_events(user_id, event) VALUES(v_user_id, 'account.oauth_linked');

  RETURN QUERY SELECT v_user_id, v_is_new;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.savoir_oauth_create_session(p_user uuid, p_hash text, p_family uuid)
RETURNS TABLE(session_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_hash !~ '^[a-f0-9]{64}$' OR p_family IS NULL THEN RAISE EXCEPTION 'Invalid session input'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.oauth_accounts oa ON oa.user_id = u.id
    WHERE u.id = p_user AND u.email_verified_at IS NOT NULL AND u.disabled_at IS NULL
  ) THEN RETURN; END IF;
  INSERT INTO public.auth_events(user_id, event) VALUES(p_user, 'session.created');
  RETURN QUERY INSERT INTO public.auth_sessions AS s(user_id, token_hash, family_id, expires_at)
    VALUES(p_user, p_hash, p_family, now() + interval '7 days') RETURNING s.id, s.user_id, s.expires_at;
END $$;
--> statement-breakpoint

-- 6. Stored functions for onboarding drafts
CREATE OR REPLACE FUNCTION public.savoir_save_onboarding_draft(
  p_user_id uuid,
  p_step integer,
  p_data jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  INSERT INTO public.onboarding_drafts(user_id, step, data, updated_at)
  VALUES(p_user_id, p_step, p_data, clock_timestamp())
  ON CONFLICT (user_id) DO UPDATE
  SET step = EXCLUDED.step, data = EXCLUDED.data, updated_at = clock_timestamp();
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.savoir_get_onboarding_draft(p_user_id uuid)
RETURNS TABLE(step integer, data jsonb, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  RETURN QUERY SELECT od.step, od.data, od.updated_at
  FROM public.onboarding_drafts od
  WHERE od.user_id = p_user_id;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.savoir_delete_onboarding_draft(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  DELETE FROM public.onboarding_drafts WHERE user_id = p_user_id;
END;
$$;
--> statement-breakpoint

-- 7. Stored function: savoir_activate_onboarding
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

  -- 5. Setup monitoring schedule with selected engines
  v_sched_config := jsonb_build_object(
    'engines', coalesce(p_engines, '["chatgpt", "gemini"]'::jsonb),
    'engine', 'gemini',
    'interval', 'daily',
    'intervalMinutes', 1440,
    'samples', 1,
    'promptIds', v_prompt_ids,
    'pausedPromptIds', '[]'::jsonb
  );

  INSERT INTO public.monitoring_schedules(tenant_id, project_id, config, status, next_run_at)
  VALUES(v_tenant_id, v_project_id, v_sched_config, 'active', clock_timestamp());

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

-- 8. Grants to savoir_runtime
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_accounts TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_drafts TO savoir_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitors TO savoir_runtime;

REVOKE ALL ON FUNCTION public.savoir_oauth_login_or_link(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_oauth_login_or_link(text, text, text, text) TO savoir_runtime;

REVOKE ALL ON FUNCTION public.savoir_oauth_create_session(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_oauth_create_session(uuid, text, uuid) TO savoir_runtime;

REVOKE ALL ON FUNCTION public.savoir_save_onboarding_draft(uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_save_onboarding_draft(uuid, integer, jsonb) TO savoir_runtime;

REVOKE ALL ON FUNCTION public.savoir_get_onboarding_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_get_onboarding_draft(uuid) TO savoir_runtime;

REVOKE ALL ON FUNCTION public.savoir_delete_onboarding_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_delete_onboarding_draft(uuid) TO savoir_runtime;

REVOKE ALL ON FUNCTION public.savoir_activate_onboarding(uuid, text, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_activate_onboarding(uuid, text, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb) TO savoir_runtime;
