-- The API uses authenticated, transaction-local owner context for technical audits.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_audits, public.technical_audit_pages, public.technical_audit_issues TO savoir_runtime;
--> statement-breakpoint
CREATE POLICY technical_audits_owner ON public.technical_audits TO savoir_runtime
USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=technical_audits.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'))
WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=technical_audits.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
--> statement-breakpoint
CREATE POLICY technical_audit_pages_owner ON public.technical_audit_pages TO savoir_runtime
USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=technical_audit_pages.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'))
WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=technical_audit_pages.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
--> statement-breakpoint
CREATE POLICY technical_audit_issues_owner ON public.technical_audit_issues TO savoir_runtime
USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=technical_audit_issues.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'))
WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=technical_audit_issues.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.role='owner'));
