CREATE FUNCTION public.savoir_public_api_identity(p_hash text, p_project uuid, p_scope text)
RETURNS TABLE(key_id uuid,tenant_id uuid,project_id uuid,user_id uuid,rate_limit_rpm integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE selected_key public.tenant_api_keys%ROWTYPE; owner_id uuid;
BEGIN
  IF p_hash !~ '^[a-f0-9]{64}$' OR p_scope NOT IN ('read:traffic','read:actions') THEN RETURN; END IF;
  SELECT k.* INTO selected_key FROM public.tenant_api_keys k
    JOIN public.projects p ON p.id=k.project_id AND p.tenant_id=k.tenant_id
    JOIN public.tenants t ON t.id=k.tenant_id
    WHERE k.key_hash=p_hash AND k.project_id=p_project AND k.revoked_at IS NULL
      AND (k.expires_at IS NULL OR k.expires_at > now()) AND p.status='active' AND t.status='active'
      AND (k.scopes ? 'read' OR k.scopes ? p_scope) LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT m.user_id INTO owner_id FROM public.memberships m JOIN public.users u ON u.id=m.user_id
    WHERE m.tenant_id=selected_key.tenant_id AND m.role='owner' AND u.disabled_at IS NULL ORDER BY m.user_id LIMIT 1;
  IF owner_id IS NULL THEN RETURN; END IF;
  UPDATE public.tenant_api_keys SET last_used_at=now() WHERE id=selected_key.id;
  RETURN QUERY SELECT selected_key.id,selected_key.tenant_id,selected_key.project_id,owner_id,selected_key.rate_limit_rpm;
END $$;
REVOKE ALL ON FUNCTION public.savoir_public_api_identity(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.savoir_public_api_identity(text,uuid,text) TO savoir_runtime;
