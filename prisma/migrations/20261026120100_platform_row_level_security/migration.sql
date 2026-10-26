-- Row-level security, the second isolation layer of ADR-02 (the first is the tenant guard in
-- Prisma). The UnitOfWork opens every unit as a transaction and sets the tenant first:
--   SELECT pg_catalog.set_config('app.tenant_id', <tenant>, true)   -- SET LOCAL
-- so the setting ends with the transaction and never leaks to the next user of a pooled
-- connection. A statement outside a unit has no tenant and sees no row.

-- The tenant of the current transaction, or NULL when none is set. NULL never equals a
-- tenant_id, so a policy built on it fails closed. A plain SQL function, so the planner can
-- inline it into each policy.
CREATE FUNCTION "platform"."current_tenant_id"() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(pg_catalog.current_setting('app.tenant_id', true), '') $$;

REVOKE ALL ON FUNCTION "platform"."current_tenant_id"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "platform"."current_tenant_id"() TO "phoenix_app";

-- The reference policy: every tenant-scoped table gets the same two lines in the migration that
-- creates it (a database test checks that each one has them). The table owner (the migration
-- role) is not subject to it; the application login is, and it has no BYPASSRLS (start-up
-- self-check).
ALTER TABLE "platform"."isolation_probe" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "isolation_probe_tenant_isolation" ON "platform"."isolation_probe"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
