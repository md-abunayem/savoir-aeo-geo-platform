-- Minimal authenticated project discovery; does not grant cross-tenant table access.
CREATE FUNCTION public.savoir_owned_projects(p_user uuid,p_after uuid,p_limit integer)
RETURNS TABLE(id uuid,tenant_id uuid,tenant_name text,brand_name text,domain text,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 THEN RAISE EXCEPTION 'INVALID_LIMIT'; END IF;
 RETURN QUERY SELECT p.id,p.tenant_id,t.name::text,p.brand_name::text,p.domain::text,p.status::text
 FROM public.projects p JOIN public.tenants t ON t.id=p.tenant_id
 JOIN public.memberships m ON m.tenant_id=t.id AND m.user_id=p_user AND m.role='owner'
 JOIN public.users u ON u.id=m.user_id AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL
 WHERE (p_after IS NULL OR p.id>p_after) ORDER BY p.id LIMIT p_limit;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.savoir_owned_projects(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_owned_projects(uuid,uuid,integer) TO savoir_runtime;
