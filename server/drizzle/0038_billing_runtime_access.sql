-- Billing reads and checkout customer lookup require authenticated owner context.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tenant_subscriptions', 'credit_ledger_entries', 'crawl_credits'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO savoir_runtime', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO savoir_runtime USING (
        tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid
        AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = %I.tenant_id
          AND m.user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid AND m.role = ''owner''))',
      table_name || '_runtime_read', table_name, table_name);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT INSERT ON public.tenant_subscriptions TO savoir_runtime;
--> statement-breakpoint
CREATE POLICY tenant_subscriptions_runtime_initialize ON public.tenant_subscriptions
FOR INSERT TO savoir_runtime WITH CHECK (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND plan_tier = 'starter' AND status = 'active'
  AND stripe_customer_id IS NULL AND stripe_subscription_id IS NULL
  AND monthly_credits = 2000 AND monthly_crawl_credits = 500
  AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = tenant_subscriptions.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
);
