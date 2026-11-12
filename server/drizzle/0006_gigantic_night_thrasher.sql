CREATE TABLE "password_reset_tokens" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY password_reset_internal ON public.password_reset_tokens TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE FUNCTION public.savoir_password_reset_issue(p_email text,p_hash text,p_expiry timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_expiry IS NULL OR p_expiry<=clock_timestamp() OR p_expiry>clock_timestamp()+interval '31 minutes' THEN RAISE EXCEPTION 'Invalid reset input'; END IF;
  SELECT u.id INTO v_id FROM public.users u WHERE lower(u.email)=lower(p_email) AND u.disabled_at IS NULL AND u.password_hash IS NOT NULL FOR NO KEY UPDATE;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.password_reset_tokens WHERE user_id=v_id AND created_at>clock_timestamp()-interval '60 seconds') THEN RETURN NULL; END IF;
  INSERT INTO public.password_reset_tokens(token_hash,user_id,expires_at) VALUES(p_hash,v_id,p_expiry)
  ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=clock_timestamp();
  INSERT INTO public.auth_events(user_id,event) VALUES(v_id,'password.reset_requested');
  RETURN v_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_password_reset_valid(p_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.password_reset_tokens t JOIN public.users u ON u.id=t.user_id WHERE t.token_hash=p_hash AND t.expires_at>now() AND u.disabled_at IS NULL AND u.password_hash IS NOT NULL);
$$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_password_reset_consume(p_hash text,p_password text)
RETURNS TABLE(id uuid,email varchar) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_password IS NULL OR p_password !~ '^[$]2[ab][$]12[$][./A-Za-z0-9]{53}$' THEN RAISE EXCEPTION 'Invalid password input'; END IF;
  SELECT u.id INTO v_id FROM public.users u JOIN public.password_reset_tokens t ON t.user_id=u.id
    WHERE t.token_hash=p_hash AND t.expires_at>clock_timestamp() AND u.disabled_at IS NULL AND u.password_hash IS NOT NULL FOR NO KEY UPDATE OF u;
  IF v_id IS NULL THEN RETURN; END IF;
  DELETE FROM public.password_reset_tokens t WHERE t.user_id=v_id AND t.token_hash=p_hash AND t.expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.users u SET password_hash=p_password,email_verified_at=coalesce(u.email_verified_at,clock_timestamp()),updated_at=clock_timestamp() WHERE u.id=v_id;
  DELETE FROM public.email_verification_tokens t WHERE t.user_id=v_id;
  UPDATE public.auth_sessions s SET revoked_at=coalesce(s.revoked_at,clock_timestamp()) WHERE s.user_id=v_id;
  INSERT INTO public.auth_events(user_id,event) VALUES(v_id,'password.reset_completed');
  RETURN QUERY SELECT u.id,u.email FROM public.users u WHERE u.id=v_id;
END $$;
--> statement-breakpoint
-- Serialize session creation against password reset and recheck the credential that was compared.
CREATE FUNCTION public.savoir_auth_create_session(p_user uuid,p_hash text,p_family uuid,p_password text)
RETURNS TABLE(session_id uuid,user_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  PERFORM 1 FROM public.users u WHERE u.id=p_user AND u.password_hash=p_password AND u.email_verified_at IS NOT NULL AND u.disabled_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.savoir_auth_create_session(p_user,p_hash,p_family);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.savoir_auth_create_session(uuid,text,uuid) FROM savoir_runtime;
REVOKE ALL ON FUNCTION public.savoir_password_reset_issue(text,text,timestamptz),public.savoir_password_reset_valid(text),public.savoir_password_reset_consume(text,text),public.savoir_auth_create_session(uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_password_reset_issue(text,text,timestamptz),public.savoir_password_reset_valid(text),public.savoir_password_reset_consume(text,text),public.savoir_auth_create_session(uuid,text,uuid,text) TO savoir_runtime;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.savoir_auth_rotate_session(p_old_hash text, p_new_hash text)
RETURNS TABLE(result text, session_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE previous public.auth_sessions%ROWTYPE;
BEGIN
  IF p_old_hash !~ '^[a-f0-9]{64}$' OR p_new_hash !~ '^[a-f0-9]{64}$' OR p_old_hash=p_new_hash THEN
    RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  SELECT * INTO previous FROM public.auth_sessions s WHERE s.token_hash=p_old_hash;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid'::text,NULL::uuid,NULL::uuid,NULL::timestamptz; RETURN; END IF;
  PERFORM 1 FROM public.users u WHERE u.id=previous.user_id FOR NO KEY UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(previous.family_id::text,0));
  SELECT * INTO previous FROM public.auth_sessions s WHERE s.token_hash=p_old_hash FOR UPDATE;
  IF previous.revoked_at IS NOT NULL THEN
    UPDATE public.auth_sessions s SET revoked_at=coalesce(s.revoked_at,now()) WHERE s.family_id=previous.family_id;
    INSERT INTO public.auth_events(user_id,event) VALUES(previous.user_id,'session.replay_revoked');
    RETURN QUERY SELECT 'reused'::text,NULL::uuid,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  IF previous.expires_at<=now() OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=previous.user_id AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL) THEN
    UPDATE public.auth_sessions s SET revoked_at=coalesce(s.revoked_at,now()) WHERE s.family_id=previous.family_id;
    RETURN QUERY SELECT 'expired'::text,NULL::uuid,NULL::uuid,NULL::timestamptz; RETURN;
  END IF;
  UPDATE public.auth_sessions s SET revoked_at=now() WHERE s.id=previous.id;
  INSERT INTO public.auth_events(user_id,event) VALUES(previous.user_id,'session.rotated');
  RETURN QUERY INSERT INTO public.auth_sessions AS s(user_id,token_hash,family_id,expires_at)
    VALUES(previous.user_id,p_new_hash,previous.family_id,previous.expires_at)
    RETURNING 'ok'::text,s.id,s.user_id,s.expires_at;
END $$;
