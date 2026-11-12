CREATE TABLE "email_verification_tokens" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY verification_internal ON public.email_verification_tokens TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE FUNCTION public.savoir_register(p_name text,p_email text,p_password text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 150 OR p_email IS NULL OR length(p_email) NOT BETWEEN 3 AND 255 OR p_password IS NULL OR p_password !~ '^[$]2[ab][$]12[$][./A-Za-z0-9]{53}$' THEN RAISE EXCEPTION 'Invalid registration input'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(p_email), 1));
  IF EXISTS(SELECT 1 FROM public.users WHERE lower(email)=lower(p_email)) THEN RETURN NULL; END IF;
  INSERT INTO public.users(name,email,password_hash) VALUES(trim(p_name),lower(p_email),p_password) RETURNING id INTO v_id;
  INSERT INTO public.auth_events(user_id,event) VALUES(v_id,'account.registered');
  RETURN v_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_verification_issue(p_email text,p_hash text,p_expiry timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_expiry IS NULL OR p_expiry<=now() OR p_expiry>now()+interval '31 minutes' THEN RAISE EXCEPTION 'Invalid verification input'; END IF;
  SELECT id INTO v_id FROM public.users WHERE lower(email)=lower(p_email) AND email_verified_at IS NULL AND disabled_at IS NULL AND password_hash IS NOT NULL FOR UPDATE;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.email_verification_tokens WHERE user_id=v_id AND created_at>now()-interval '60 seconds') THEN RETURN NULL; END IF;
  INSERT INTO public.email_verification_tokens(token_hash,user_id,expires_at) VALUES(p_hash,v_id,p_expiry)
    ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=now();
  INSERT INTO public.auth_events(user_id,event) VALUES(v_id,'email.verification_requested');
  RETURN v_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_verification_find(p_hash text)
RETURNS TABLE(password_hash varchar) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
  SELECT u.password_hash FROM public.email_verification_tokens t JOIN public.users u ON u.id=t.user_id
  WHERE t.token_hash=p_hash AND t.expires_at>now() AND u.disabled_at IS NULL AND u.email_verified_at IS NULL;
$$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_verification_consume(p_hash text,p_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE v_id uuid;
BEGIN
  -- Match the password hash checked by the service; concurrent password changes fail closed.
  SELECT u.id INTO v_id FROM public.users u JOIN public.email_verification_tokens t ON t.user_id=u.id
    WHERE t.token_hash=p_hash AND t.expires_at>now() AND u.password_hash=p_password AND u.disabled_at IS NULL AND u.email_verified_at IS NULL FOR UPDATE OF u;
  IF v_id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.email_verification_tokens WHERE user_id=v_id AND token_hash=p_hash AND expires_at>now();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.users SET email_verified_at=now(),updated_at=now() WHERE id=v_id;
  INSERT INTO public.auth_events(user_id,event) VALUES(v_id,'email.verified');
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_register(text,text,text),public.savoir_verification_issue(text,text,timestamptz),public.savoir_verification_find(text),public.savoir_verification_consume(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_register(text,text,text),public.savoir_verification_issue(text,text,timestamptz),public.savoir_verification_find(text),public.savoir_verification_consume(text,text) TO savoir_runtime;
