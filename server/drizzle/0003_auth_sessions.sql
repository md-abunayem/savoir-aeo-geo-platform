CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_family_idx" ON "auth_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_events FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_internal_users ON users TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY identity_internal_sessions ON auth_sessions TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY identity_internal_events ON auth_events TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE FUNCTION public.savoir_auth_find_user(p_email text)
RETURNS TABLE(id uuid, name varchar, email varchar, password_hash varchar, email_verified_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT u.id,u.name,u.email,u.password_hash,u.email_verified_at
  FROM public.users u WHERE lower(u.email)=lower(p_email) AND u.disabled_at IS NULL
$$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_auth_create_session(p_user uuid, p_hash text, p_family uuid)
RETURNS TABLE(session_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_hash !~ '^[a-f0-9]{64}$' OR p_family IS NULL THEN RAISE EXCEPTION 'Invalid session input'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_user AND u.email_verified_at IS NOT NULL AND u.disabled_at IS NULL) THEN RETURN; END IF;
  INSERT INTO public.auth_events(user_id,event) VALUES(p_user,'session.created');
  RETURN QUERY INSERT INTO public.auth_sessions AS s(user_id,token_hash,family_id,expires_at)
    VALUES(p_user,p_hash,p_family,now()+interval '7 days') RETURNING s.id,s.user_id,s.expires_at;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_auth_rotate_session(p_old_hash text, p_new_hash text)
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
--> statement-breakpoint
CREATE FUNCTION public.savoir_auth_revoke_session(p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE target public.auth_sessions%ROWTYPE;
BEGIN
  SELECT * INTO target FROM public.auth_sessions s WHERE s.token_hash=p_hash;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target.family_id::text,0));
  UPDATE public.auth_sessions s SET revoked_at=coalesce(s.revoked_at,now()) WHERE s.family_id=target.family_id;
  INSERT INTO public.auth_events(user_id,event) VALUES(target.user_id,'session.logged_out');
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_auth_session_user(p_session uuid,p_user uuid)
RETURNS TABLE(id uuid,name varchar,email varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT u.id,u.name,u.email FROM public.users u JOIN public.auth_sessions s ON s.user_id=u.id
  WHERE s.id=p_session AND u.id=p_user AND s.revoked_at IS NULL AND s.expires_at>now()
    AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_auth_find_user(text),public.savoir_auth_create_session(uuid,text,uuid),public.savoir_auth_rotate_session(text,text),public.savoir_auth_revoke_session(text),public.savoir_auth_session_user(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_auth_find_user(text),public.savoir_auth_create_session(uuid,text,uuid),public.savoir_auth_rotate_session(text,text),public.savoir_auth_revoke_session(text),public.savoir_auth_session_user(uuid,uuid) TO savoir_runtime;

