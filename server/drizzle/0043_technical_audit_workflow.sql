ALTER TABLE public.technical_audit_issues
  ADD COLUMN status varchar(20) NOT NULL DEFAULT 'open',
  ADD CONSTRAINT technical_audit_issues_status_check
    CHECK (status IN ('open', 'fixed', 'dismissed'));
--> statement-breakpoint
CREATE TABLE public.technical_audit_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  frequency varchar(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT technical_audit_schedules_project_unique UNIQUE (project_id)
);
--> statement-breakpoint
CREATE INDEX technical_audit_schedules_due_idx
  ON public.technical_audit_schedules(is_active, next_run_at);
--> statement-breakpoint
ALTER TABLE public.technical_audit_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_audit_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY technical_audit_schedules_internal ON public.technical_audit_schedules
  TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY technical_audit_schedules_owner ON public.technical_audit_schedules
  TO savoir_runtime
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.tenant_id = technical_audit_schedules.tenant_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND m.role = 'owner'
    )
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.tenant_id = technical_audit_schedules.tenant_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND m.role = 'owner'
    )
  );
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_audit_schedules TO savoir_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.savoir_technical_audit_claim_due(p_limit integer)
RETURNS TABLE(schedule_id uuid, tenant_id uuid, project_id uuid, user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH due AS (
    SELECT s.id
    FROM public.technical_audit_schedules s
    WHERE s.is_active AND s.next_run_at <= clock_timestamp()
    ORDER BY s.next_run_at
    LIMIT greatest(1, least(p_limit, 20))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.technical_audit_schedules s
    SET last_run_at = clock_timestamp(),
        next_run_at = greatest(s.next_run_at, clock_timestamp()) + CASE s.frequency
          WHEN 'daily' THEN interval '1 day'
          WHEN 'weekly' THEN interval '1 week'
          ELSE interval '1 month'
        END,
        updated_at = clock_timestamp()
    FROM due
    WHERE s.id = due.id
    RETURNING s.id, s.tenant_id, s.project_id, s.created_by
  )
  SELECT c.id, c.tenant_id, c.project_id, c.created_by
  FROM claimed c
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_technical_audit_claim_due(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_technical_audit_claim_due(integer) TO savoir_runtime;
