-- Shared capability role. Login credentials are provisioned separately, never in migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'savoir_runtime') THEN
    CREATE ROLE savoir_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'savoir_runtime' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolcanlogin)) THEN
    RAISE EXCEPTION 'savoir_runtime exists with unsafe privileges';
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO savoir_runtime;
GRANT SELECT ON users, tenants, memberships, projects TO savoir_runtime;
GRANT INSERT, UPDATE, DELETE ON projects TO savoir_runtime;
GRANT UPDATE (name, region) ON tenants TO savoir_runtime;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_self ON users TO savoir_runtime
  USING (id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY membership_self ON memberships TO savoir_runtime
  USING (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND role = 'owner'
  );
--> statement-breakpoint
CREATE POLICY tenant_owner ON tenants TO savoir_runtime
  USING (
    id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = tenants.id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
  )
  WITH CHECK (
    id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = tenants.id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
  );
--> statement-breakpoint
CREATE POLICY project_owner ON projects TO savoir_runtime
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = projects.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = projects.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid AND m.role = 'owner')
  );
