CREATE OR REPLACE FUNCTION public.savoir_register(p_name text,p_email text,p_password text,p_auto_verify boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 150 OR p_email IS NULL OR length(p_email) NOT BETWEEN 3 AND 255 OR p_password IS NULL OR p_password !~ '^[$]2[ab][$]12[$][./A-Za-z0-9]{53}$' THEN RAISE EXCEPTION 'Invalid registration input'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(p_email), 1));
  IF EXISTS(SELECT 1 FROM public.users WHERE lower(email)=lower(p_email)) THEN RETURN NULL; END IF;
  INSERT INTO public.users(name,email,password_hash,email_verified_at)
  VALUES(trim(p_name),lower(p_email),p_password,CASE WHEN p_auto_verify THEN clock_timestamp() ELSE NULL END)
  RETURNING id INTO v_id;
  INSERT INTO public.auth_events(user_id,event) VALUES(v_id,'account.registered');
  IF p_auto_verify THEN
    INSERT INTO public.auth_events(user_id,event) VALUES(v_id,'email.verified');
  END IF;
  RETURN v_id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.savoir_register(p_name text,p_email text,p_password text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
  SELECT public.savoir_register(p_name, p_email, p_password, false);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_register(text,text,text,boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.savoir_register(text,text,text,boolean) TO savoir_runtime;
--> statement-breakpoint
UPDATE public.users SET email_verified_at=coalesce(email_verified_at, clock_timestamp()) WHERE email_verified_at IS NULL;

