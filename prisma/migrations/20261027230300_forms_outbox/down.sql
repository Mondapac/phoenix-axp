-- Reverses 20261027230300_forms_outbox: the policy and grants, then the table (its CHECKs and
-- indexes go with it).
DROP POLICY "outbox_tenant_isolation" ON "forms"."outbox";
REVOKE ALL ON TABLE "forms"."outbox" FROM "phoenix_app";
DROP TABLE "forms"."outbox";
