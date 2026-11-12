-- Only the verified Stripe webhook handler calls this narrow write capability.
CREATE TABLE public.billing_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.billing_credit_grants (
  reference_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('monitoring', 'crawl')),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  PRIMARY KEY (reference_id, category)
);
REVOKE ALL ON public.billing_webhook_events, public.billing_credit_grants FROM PUBLIC, savoir_runtime;
ALTER TABLE public.tenant_subscriptions ADD COLUMN stripe_event_created bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE FUNCTION public.savoir_apply_billing_event(p jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  kind text := p->>'eventType';
  event_time bigint := (p->>'created')::bigint;
  tenant uuid;
  sub public.tenant_subscriptions%ROWTYPE;
  plan text := p->>'planTier';
  mon integer;
  crawl integer;
  grant_reference text;
  grant_kind text;
  balance integer;
  inserted integer;
BEGIN
  IF coalesce(p->>'eventId','') !~ '^evt_[A-Za-z0-9_]+$' OR event_time IS NULL OR event_time < 0
     OR coalesce(p->>'objectId','') = '' OR kind NOT IN (
       'checkout.session.completed','checkout.session.async_payment_succeeded',
       'invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted') THEN
    RAISE EXCEPTION 'Invalid billing event' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.billing_webhook_events(event_id,event_type) VALUES(p->>'eventId',kind) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RETURN 'duplicate'; END IF;

  -- Serialize different events for the same subscription; event IDs alone are insufficient.
  PERFORM pg_advisory_xact_lock(hashtextextended('billing:' || coalesce(p->>'subscriptionId',p->>'tenantId',p->>'objectId'),0));

  IF kind IN ('checkout.session.completed','checkout.session.async_payment_succeeded') THEN
    tenant := (p->>'tenantId')::uuid;
    IF tenant IS NULL OR plan IS NULL OR plan NOT IN ('starter','growth','enterprise','topup_1000') THEN
      RAISE EXCEPTION 'Invalid checkout metadata' USING ERRCODE='22023';
    END IF;
    IF plan = 'topup_1000' THEN
      IF coalesce((p->>'paid')::boolean,false) = false THEN RETURN 'awaiting_payment'; END IF;
      mon := 1000; crawl := 0; grant_reference := 'checkout:' || (p->>'objectId'); grant_kind := 'credit_topup';
    ELSE
      IF coalesce(p->>'subscriptionId','') = '' OR coalesce(p->>'customerId','') = '' THEN
        RAISE EXCEPTION 'Missing checkout subscription' USING ERRCODE='22023';
      END IF;
      IF EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE stripe_subscription_id=p->>'subscriptionId' AND tenant_id <> tenant) THEN
        RAISE EXCEPTION 'Subscription belongs to another tenant' USING ERRCODE='22023';
      END IF;
      mon := CASE plan WHEN 'starter' THEN 2000 WHEN 'growth' THEN 8000 ELSE 30000 END;
      crawl := CASE plan WHEN 'starter' THEN 500 WHEN 'growth' THEN 2000 ELSE 10000 END;
      INSERT INTO public.tenant_subscriptions(tenant_id,stripe_customer_id,stripe_subscription_id,plan_tier,status,monthly_credits,monthly_crawl_credits,stripe_event_created)
      VALUES(tenant,p->>'customerId',p->>'subscriptionId',plan,'incomplete',mon,crawl,event_time)
      ON CONFLICT (tenant_id) DO UPDATE SET
        stripe_customer_id=EXCLUDED.stripe_customer_id, stripe_subscription_id=EXCLUDED.stripe_subscription_id,
        status=CASE WHEN tenant_subscriptions.stripe_subscription_id IS DISTINCT FROM EXCLUDED.stripe_subscription_id THEN 'incomplete' ELSE tenant_subscriptions.status END,
        plan_tier=EXCLUDED.plan_tier, monthly_credits=EXCLUDED.monthly_credits, monthly_crawl_credits=EXCLUDED.monthly_crawl_credits,
        stripe_event_created=EXCLUDED.stripe_event_created, updated_at=now()
      WHERE tenant_subscriptions.stripe_event_created <= event_time
        AND (tenant_subscriptions.stripe_subscription_id IS NULL OR tenant_subscriptions.stripe_subscription_id=EXCLUDED.stripe_subscription_id
          OR tenant_subscriptions.status IN ('canceled','incomplete_expired'));
      -- Only invoice.paid grants recurring credits, including the first invoice.
      RETURN 'linked';
    END IF;
  ELSE
    IF coalesce(p->>'subscriptionId','') = '' THEN RETURN 'ignored'; END IF;
    SELECT * INTO sub FROM public.tenant_subscriptions WHERE stripe_subscription_id=p->>'subscriptionId' FOR UPDATE;
    IF NOT FOUND THEN
      -- Roll back the receipt too: Stripe may deliver the invoice before Checkout.
      RAISE EXCEPTION 'Subscription not linked yet' USING ERRCODE='P0001';
    END IF;
    tenant := sub.tenant_id;
    IF p->>'customerId' IS NOT NULL AND sub.stripe_customer_id IS DISTINCT FROM p->>'customerId' THEN
      RAISE EXCEPTION 'Billing customer mismatch' USING ERRCODE='22023';
    END IF;
    IF kind='invoice.paid' THEN
      IF coalesce((p->>'paid')::boolean,false)=false THEN RETURN 'ignored'; END IF;
      UPDATE public.tenant_subscriptions SET status='active',
        current_period_start=coalesce(to_timestamp((p->>'periodStart')::double precision),current_period_start),
        current_period_end=coalesce(to_timestamp((p->>'periodEnd')::double precision),current_period_end),
        stripe_event_created=event_time,updated_at=now()
        WHERE id=sub.id AND stripe_event_created <= event_time AND status <> 'canceled';
      IF coalesce(p->>'billingReason','') NOT IN ('subscription_create','subscription_cycle') THEN RETURN 'updated'; END IF;
      mon := CASE plan WHEN 'starter' THEN 2000 WHEN 'growth' THEN 8000 WHEN 'enterprise' THEN 30000 ELSE sub.monthly_credits END;
      crawl := CASE plan WHEN 'starter' THEN 500 WHEN 'growth' THEN 2000 WHEN 'enterprise' THEN 10000 ELSE sub.monthly_crawl_credits END;
      grant_reference := 'invoice:' || (p->>'objectId'); grant_kind := 'plan_allocation';
    ELSIF kind='invoice.payment_failed' THEN
      UPDATE public.tenant_subscriptions SET status='past_due',stripe_event_created=event_time,updated_at=now()
        WHERE id=sub.id AND stripe_event_created < event_time AND status <> 'canceled';
      RETURN 'updated';
    ELSE
      IF kind='customer.subscription.deleted' THEN
        UPDATE public.tenant_subscriptions SET status='canceled',stripe_event_created=event_time,updated_at=now()
          WHERE id=sub.id AND stripe_event_created <= event_time;
      ELSE
        IF coalesce(p->>'status','') NOT IN ('active','past_due','canceled','trialing','incomplete','incomplete_expired','unpaid','paused') THEN
          RAISE EXCEPTION 'Invalid subscription status' USING ERRCODE='22023';
        END IF;
        UPDATE public.tenant_subscriptions SET status=p->>'status',
          cancel_at_period_end=coalesce((p->>'cancelAtPeriodEnd')::boolean,false),
          plan_tier=CASE WHEN plan IN ('starter','growth','enterprise') THEN plan ELSE plan_tier END,
          monthly_credits=CASE plan WHEN 'starter' THEN 2000 WHEN 'growth' THEN 8000 WHEN 'enterprise' THEN 30000 ELSE monthly_credits END,
          monthly_crawl_credits=CASE plan WHEN 'starter' THEN 500 WHEN 'growth' THEN 2000 WHEN 'enterprise' THEN 10000 ELSE monthly_crawl_credits END,
          current_period_start=coalesce(to_timestamp((p->>'periodStart')::double precision),current_period_start),
          current_period_end=coalesce(to_timestamp((p->>'periodEnd')::double precision),current_period_end),
          stripe_event_created=event_time,updated_at=now()
          WHERE id=sub.id AND stripe_event_created <= event_time AND status <> 'canceled';
      END IF;
      RETURN 'updated';
    END IF;
  END IF;

  INSERT INTO public.billing_credit_grants(reference_id,category,tenant_id) VALUES(grant_reference,'monitoring',tenant) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted=1 AND NOT EXISTS (SELECT 1 FROM public.credit_ledger_entries WHERE tenant_id=tenant AND category='monitoring' AND reference_id=p->>'objectId' AND entry_type=grant_kind) THEN
    INSERT INTO public.monitoring_credits(tenant_id,available,reserved,used) VALUES(tenant,mon,0,0)
      ON CONFLICT (tenant_id) DO UPDATE SET available=monitoring_credits.available+EXCLUDED.available
      RETURNING available INTO balance;
    INSERT INTO public.credit_ledger_entries(tenant_id,entry_type,category,amount,balance_after,reference_id,description)
      VALUES(tenant,grant_kind,'monitoring',mon,balance,p->>'objectId','Stripe payment: ' || grant_reference);
  END IF;
  IF crawl > 0 THEN
    INSERT INTO public.billing_credit_grants(reference_id,category,tenant_id) VALUES(grant_reference,'crawl',tenant) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted=1 AND NOT EXISTS (SELECT 1 FROM public.credit_ledger_entries WHERE tenant_id=tenant AND category='crawl' AND reference_id=p->>'objectId' AND entry_type=grant_kind) THEN
      INSERT INTO public.crawl_credits(tenant_id,available,used) VALUES(tenant,crawl,0)
        ON CONFLICT (tenant_id) DO UPDATE SET available=crawl_credits.available+EXCLUDED.available
        RETURNING available INTO balance;
      INSERT INTO public.credit_ledger_entries(tenant_id,entry_type,category,amount,balance_after,reference_id,description)
        VALUES(tenant,grant_kind,'crawl',crawl,balance,p->>'objectId','Stripe payment: ' || grant_reference);
    END IF;
  END IF;
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION public.savoir_apply_billing_event(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_apply_billing_event(jsonb) TO savoir_runtime;
