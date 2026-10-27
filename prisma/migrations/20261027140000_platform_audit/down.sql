-- Reverses 20261027140000_platform_audit, in reverse order: the policies and grants, the
-- triggers and their function, then the tables (the seal first: its foreign key references the
-- log) with their CHECKs and indexes. Dropping the log loses the audit trail: run it only on a
-- database whose audit rows may go (development, or a failed deployment before any traffic).
DROP POLICY "audit_chain_checkpoint_tenant_isolation" ON "platform"."audit_chain_checkpoint";
DROP POLICY "audit_log_seal_tenant_isolation" ON "platform"."audit_log_seal";
DROP POLICY "audit_log_tenant_isolation" ON "platform"."audit_log";

REVOKE SELECT, INSERT ON TABLE "platform"."audit_chain_checkpoint" FROM "phoenix_app";
REVOKE SELECT, INSERT ON TABLE "platform"."audit_log_seal" FROM "phoenix_app";
REVOKE SELECT, INSERT ON TABLE "platform"."audit_log" FROM "phoenix_app";

DROP TRIGGER "audit_chain_checkpoint_no_truncate" ON "platform"."audit_chain_checkpoint";
DROP TRIGGER "audit_chain_checkpoint_no_update_delete" ON "platform"."audit_chain_checkpoint";
DROP TRIGGER "audit_log_seal_no_truncate" ON "platform"."audit_log_seal";
DROP TRIGGER "audit_log_seal_no_update_delete" ON "platform"."audit_log_seal";
DROP TRIGGER "audit_log_no_truncate" ON "platform"."audit_log";
DROP TRIGGER "audit_log_no_update_delete" ON "platform"."audit_log";
DROP FUNCTION "platform"."audit_reject_mutation"();

DROP TABLE "platform"."audit_chain_checkpoint";
DROP TABLE "platform"."audit_log_seal";
DROP TABLE "platform"."audit_log";
