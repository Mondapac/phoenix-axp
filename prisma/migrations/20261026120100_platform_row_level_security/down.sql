DROP POLICY "isolation_probe_tenant_isolation" ON "platform"."isolation_probe";
ALTER TABLE "platform"."isolation_probe" DISABLE ROW LEVEL SECURITY;
DROP FUNCTION "platform"."current_tenant_id"();
