-- Reverses 20261027200000_identity_field_access: the policies and grants first, then the two
-- tables (their CHECKs, keys and foreign keys go with them).
DROP POLICY "role_field_rule_tenant_isolation" ON "identity"."role_field_rule";
DROP POLICY "role_definition_scope_tenant_isolation" ON "identity"."role_definition_scope";

REVOKE ALL ON TABLE "identity"."role_field_rule" FROM "phoenix_app";
REVOKE ALL ON TABLE "identity"."role_definition_scope" FROM "phoenix_app";

DROP TABLE "identity"."role_field_rule";
DROP TABLE "identity"."role_definition_scope";
