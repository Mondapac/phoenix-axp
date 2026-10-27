-- Reverses 20261027180000_identity_directory_sync: the policy and grants, then the table.
DROP POLICY "directory_sync_tenant_isolation" ON "identity"."directory_sync";
REVOKE ALL ON TABLE "identity"."directory_sync" FROM "phoenix_app";
DROP TABLE "identity"."directory_sync";
