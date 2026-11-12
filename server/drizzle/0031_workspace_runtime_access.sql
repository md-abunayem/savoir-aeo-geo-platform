-- Later workspace tables were created with policies for the migration owner
-- only. Grant the API role access under authenticated tenant-owner context.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agent_policies', 'content_items', 'content_gaps', 'content_briefs',
    'action_items', 'action_comments', 'integration_connections',
    'gsc_performance_facts', 'traffic_analytics_facts', 'tenant_api_keys',
    'webhook_endpoints', 'report_schedules', 'generated_reports',
    'alert_rules', 'alert_incidents'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO savoir_runtime', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I TO savoir_runtime
       USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid
         AND EXISTS (SELECT 1 FROM public.memberships m
           WHERE m.tenant_id = %I.tenant_id
             AND m.user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid
             AND m.role = ''owner''))
       WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid
         AND EXISTS (SELECT 1 FROM public.memberships m
           WHERE m.tenant_id = %I.tenant_id
             AND m.user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid
             AND m.role = ''owner''))',
      table_name || '_runtime_owner', table_name, table_name, table_name
    );
  END LOOP;
END $$;
