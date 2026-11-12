CREATE TYPE "public"."email_status" AS ENUM('pending', 'processing', 'accepted', 'failed', 'uncertain');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"encrypted_payload" text,
	"status" "email_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_id" uuid,
	"locked_at" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"provider_message_id" text,
	"error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("status","available_at");
--> statement-breakpoint
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY email_internal ON email_outbox TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE FUNCTION public.savoir_email_enqueue(p_id uuid,p_user uuid,p_payload text,p_expiry timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_id IS NULL OR p_user IS NULL OR p_payload IS NULL OR length(p_payload)>200000 OR p_expiry<=now() OR p_expiry>now()+interval '24 hours' THEN RAISE EXCEPTION 'Invalid email outbox input'; END IF;
  INSERT INTO public.email_outbox(id,user_id,encrypted_payload,expires_at) VALUES(p_id,p_user,p_payload,p_expiry) ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.email_outbox e WHERE e.id=p_id AND e.user_id=p_user) THEN RAISE EXCEPTION 'Email idempotency conflict'; END IF;
  RETURN p_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_email_claim()
RETURNS TABLE(id uuid,encrypted_payload text,lease_id uuid,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  UPDATE public.email_outbox e SET status='failed',encrypted_payload=NULL,error_code='EXPIRED',lease_id=NULL
    WHERE e.status IN ('pending','processing','uncertain') AND e.expires_at<=now();
  UPDATE public.email_outbox e SET status='uncertain',error_code='RETRY_WINDOW_EXPIRED',lease_id=NULL
    WHERE e.status IN ('pending','processing') AND e.first_attempt_at<now()-interval '20 minutes';
  UPDATE public.email_outbox e SET status='failed',encrypted_payload=NULL,error_code='ATTEMPTS_EXHAUSTED',lease_id=NULL
    WHERE e.status='pending' AND e.attempts>=5;
  UPDATE public.email_outbox e SET status='uncertain',error_code='ATTEMPTS_EXHAUSTED',lease_id=NULL WHERE e.status='processing' AND e.attempts>=5 AND e.locked_at<now()-interval '60 seconds';
  RETURN QUERY
    WITH due AS (
      SELECT e.id FROM public.email_outbox e
      WHERE e.encrypted_payload IS NOT NULL AND e.expires_at>now()
        AND (e.status='pending' AND e.available_at<=now() AND e.attempts<5 OR e.status='processing' AND e.locked_at<now()-interval '60 seconds')
      ORDER BY e.available_at,e.created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE public.email_outbox e SET status='processing',lease_id=gen_random_uuid(),locked_at=now(),
      first_attempt_at=coalesce(e.first_attempt_at,now()),attempts=e.attempts+1
    FROM due WHERE e.id=due.id RETURNING e.id,e.encrypted_payload,e.lease_id,e.attempts;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.savoir_email_complete(p_id uuid,p_lease uuid,p_status text,p_message text,p_error text,p_delay integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_status NOT IN ('accepted','pending','failed') OR p_delay<0 OR p_delay>86400 OR length(p_error)>80 THEN RAISE EXCEPTION 'Invalid email completion'; END IF;
  UPDATE public.email_outbox e SET status=p_status::public.email_status,provider_message_id=p_message,error_code=p_error,
    available_at=now()+make_interval(secs=>p_delay),locked_at=NULL,lease_id=NULL,
    encrypted_payload=CASE WHEN p_status IN ('accepted','failed') THEN NULL ELSE e.encrypted_payload END
    WHERE e.id=p_id AND e.status='processing' AND e.lease_id=p_lease;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_email_enqueue(uuid,uuid,text,timestamptz),public.savoir_email_claim(),public.savoir_email_complete(uuid,uuid,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_email_enqueue(uuid,uuid,text,timestamptz),public.savoir_email_claim(),public.savoir_email_complete(uuid,uuid,text,text,text,integer) TO savoir_runtime;

