-- Reverses 20261027160000_tenancy: the policies and grants first, then the tables (their
-- CHECKs, indexes and foreign keys go with them), then the schema.
DROP POLICY "tenant_settings_tenant_isolation" ON "tenancy"."tenant_settings";
DROP POLICY "organization_ancestry_tenant_isolation" ON "tenancy"."organization_ancestry";
DROP POLICY "organization_tenant_isolation" ON "tenancy"."organization";
DROP POLICY "site_domain_tenant_isolation" ON "tenancy"."site_domain";
DROP POLICY "site_ancestry_tenant_isolation" ON "tenancy"."site_ancestry";
DROP POLICY "site_tenant_isolation" ON "tenancy"."site";

REVOKE ALL ON TABLE "tenancy"."tenant_settings" FROM "phoenix_app";
REVOKE ALL ON TABLE "tenancy"."organization_ancestry" FROM "phoenix_app";
REVOKE ALL ON TABLE "tenancy"."organization" FROM "phoenix_app";
REVOKE ALL ON TABLE "tenancy"."site_domain" FROM "phoenix_app";
REVOKE ALL ON TABLE "tenancy"."site_ancestry" FROM "phoenix_app";
REVOKE ALL ON TABLE "tenancy"."site" FROM "phoenix_app";
REVOKE USAGE ON SCHEMA "tenancy" FROM "phoenix_app";

DROP TABLE "tenancy"."tenant_settings";
DROP TABLE "tenancy"."organization_ancestry";
DROP TABLE "tenancy"."site_ancestry";
DROP TABLE "tenancy"."site_domain";
DROP TABLE "tenancy"."site";
DROP TABLE "tenancy"."organization";
DROP SCHEMA "tenancy";
