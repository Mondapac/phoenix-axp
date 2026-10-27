-- Reverses 20261027170000_identity: the policies and grants first, then the tables (their
-- CHECKs, indexes and foreign keys go with them), then the schema.
DROP POLICY "role_assignment_tenant_isolation" ON "identity"."role_assignment";
DROP POLICY "role_tenant_isolation" ON "identity"."role";
DROP POLICY "session_tenant_isolation" ON "identity"."session";
DROP POLICY "account_tenant_isolation" ON "identity"."account";

REVOKE ALL ON TABLE "identity"."role_assignment" FROM "phoenix_app";
REVOKE ALL ON TABLE "identity"."role" FROM "phoenix_app";
REVOKE ALL ON TABLE "identity"."session" FROM "phoenix_app";
REVOKE ALL ON TABLE "identity"."account" FROM "phoenix_app";
REVOKE USAGE ON SCHEMA "identity" FROM "phoenix_app";

DROP TABLE "identity"."role_assignment";
DROP TABLE "identity"."role";
DROP TABLE "identity"."session";
DROP TABLE "identity"."account";
DROP SCHEMA "identity";
