-- Reverses 20261027190000_identity_role_grants: the original foreign key and index back.
ALTER TABLE "identity"."role_assignment" DROP CONSTRAINT "role_assignment_role_fkey";
DROP INDEX "identity"."role_assignment_tenant_id_account_id_role_id_site_id_key";
DROP INDEX "identity"."role_tenant_id_id_scope_key";
CREATE INDEX "role_assignment_tenant_id_account_id_idx" ON "identity"."role_assignment"("tenant_id", "account_id");
ALTER TABLE "identity"."role_assignment" ADD CONSTRAINT "role_assignment_role_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "identity"."role"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
