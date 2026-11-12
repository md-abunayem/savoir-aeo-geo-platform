CREATE TYPE public.studio_status AS ENUM ('draft','in_review','approved','scheduled','published','failed');
--> statement-breakpoint
CREATE TABLE public.studio_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, document jsonb NOT NULL, validation jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), status studio_status NOT NULL DEFAULT 'draft',
 approved_revision integer, approved_by uuid REFERENCES users(id), scheduled_time timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_drafts_project_idx ON studio_drafts(tenant_id,project_id);
CREATE TABLE public.publishing_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, provider text NOT NULL CHECK(provider IN ('buffer','wordpress')),
 encrypted_credentials text NOT NULL, channels jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX publishing_connections_project_provider_unique ON publishing_connections(project_id,provider);
CREATE TABLE public.studio_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, object_key text NOT NULL, public_url text NOT NULL,
 mime_type text NOT NULL, size_bytes integer NOT NULL CHECK(size_bytes>0 AND size_bytes<=104857600), ready boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.publishing_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, draft_id uuid NOT NULL REFERENCES studio_drafts(id) ON DELETE CASCADE,
 revision integer NOT NULL, platform text NOT NULL CHECK(platform IN ('facebook','instagram','x','tiktok','youtube','wordpress')),
 channel_id text NOT NULL, media_ids jsonb NOT NULL DEFAULT '[]', scheduling_type text NOT NULL DEFAULT 'automatic' CHECK(scheduling_type IN ('automatic','notification')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatching','accepted','manual_action','published','failed','uncertain')),
 remote_id text, remote_url text, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL,
 locked_at timestamptz, notice text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX publishing_deliveries_target_unique ON publishing_deliveries(draft_id,revision,platform,channel_id);
CREATE INDEX publishing_deliveries_due_idx ON publishing_deliveries(state,next_attempt_at);
--> statement-breakpoint
ALTER TABLE public.studio_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY studio_drafts_internal ON public.studio_drafts TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY studio_drafts_owner ON public.studio_drafts TO savoir_runtime
USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=studio_drafts.project_id AND p.tenant_id=studio_drafts.tenant_id)
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=studio_drafts.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner') )
WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=studio_drafts.project_id AND p.tenant_id=studio_drafts.tenant_id)
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=studio_drafts.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner') );
GRANT SELECT,INSERT,UPDATE,DELETE ON public.studio_drafts TO savoir_runtime;
--> statement-breakpoint
ALTER TABLE public.publishing_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_connections_internal ON public.publishing_connections TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY publishing_connections_owner ON public.publishing_connections TO savoir_runtime
USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=publishing_connections.project_id AND p.tenant_id=publishing_connections.tenant_id)
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=publishing_connections.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner') )
WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=publishing_connections.project_id AND p.tenant_id=publishing_connections.tenant_id)
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=publishing_connections.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner') );
GRANT SELECT,INSERT,UPDATE,DELETE ON public.publishing_connections TO savoir_runtime;
--> statement-breakpoint
ALTER TABLE public.studio_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_media FORCE ROW LEVEL SECURITY;
CREATE POLICY studio_media_internal ON public.studio_media TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY studio_media_owner ON public.studio_media TO savoir_runtime
USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=studio_media.project_id AND p.tenant_id=studio_media.tenant_id)
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=studio_media.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner') )
WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=studio_media.project_id AND p.tenant_id=studio_media.tenant_id)
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=studio_media.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner') );
GRANT SELECT,INSERT,UPDATE,DELETE ON public.studio_media TO savoir_runtime;
--> statement-breakpoint
ALTER TABLE public.publishing_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publishing_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY publishing_deliveries_internal ON public.publishing_deliveries TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE POLICY publishing_deliveries_owner ON public.publishing_deliveries TO savoir_runtime
USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=publishing_deliveries.project_id AND p.tenant_id=publishing_deliveries.tenant_id)
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=publishing_deliveries.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner')  AND EXISTS (SELECT 1 FROM studio_drafts d WHERE d.id=publishing_deliveries.draft_id AND d.project_id=publishing_deliveries.project_id AND d.tenant_id=publishing_deliveries.tenant_id))
WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=publishing_deliveries.project_id AND p.tenant_id=publishing_deliveries.tenant_id)
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=publishing_deliveries.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner')  AND EXISTS (SELECT 1 FROM studio_drafts d WHERE d.id=publishing_deliveries.draft_id AND d.project_id=publishing_deliveries.project_id AND d.tenant_id=publishing_deliveries.tenant_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.publishing_deliveries TO savoir_runtime;
--> statement-breakpoint
-- Durable outbox discovery exposes only delivery IDs and authenticated owner context.
CREATE FUNCTION public.savoir_publishing_due() RETURNS TABLE(id uuid,project_id uuid,tenant_id uuid,user_id uuid,attempts integer,due_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE publishing_deliveries SET state=CASE WHEN remote_id IS NULL THEN 'uncertain' ELSE 'accepted' END,notice='Dispatch interrupted. Reconcile with the provider before attempting another publication.',next_attempt_at=now(),updated_at=now()
 WHERE state='dispatching' AND locked_at<now()-interval '5 minutes';
 UPDATE studio_drafts a SET status='failed',updated_at=now() WHERE a.status='scheduled'
 AND EXISTS(SELECT 1 FROM publishing_deliveries d WHERE d.draft_id=a.id AND d.revision=a.revision AND d.state='uncertain');
 RETURN QUERY SELECT d.id,d.project_id,d.tenant_id,a.approved_by,d.attempts,d.next_attempt_at
 FROM publishing_deliveries d JOIN studio_drafts a ON a.id=d.draft_id AND a.tenant_id=d.tenant_id AND a.project_id=d.project_id
 JOIN memberships m ON m.tenant_id=d.tenant_id AND m.user_id=a.approved_by AND m.role='owner'
 JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
 WHERE a.status IN ('scheduled','failed') AND a.approved_revision=a.revision AND d.revision=a.revision
 AND d.state IN ('queued','accepted','manual_action') AND d.next_attempt_at<=now()+interval '1 minute'
 ORDER BY d.next_attempt_at,d.id LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.savoir_publishing_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_publishing_due() TO savoir_runtime;

