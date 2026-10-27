-- Reverses 20261027230400_process_form_link: the policies and grants, the tables (their CHECKs,
-- indexes and foreign keys go with them), then the two columns and their index.
DROP POLICY "inbox_tenant_isolation" ON "process"."inbox";
DROP POLICY "process_start_form_tenant_isolation" ON "process"."process_start_form";
DROP POLICY "process_form_binding_tenant_isolation" ON "process"."process_form_binding";

REVOKE ALL ON TABLE "process"."inbox" FROM "phoenix_app";
REVOKE ALL ON TABLE "process"."process_start_form" FROM "phoenix_app";
REVOKE ALL ON TABLE "process"."process_form_binding" FROM "phoenix_app";

DROP TABLE "process"."inbox";
DROP TABLE "process"."process_start_form";
DROP TABLE "process"."process_form_binding";

DROP INDEX "process"."process_instance_tenant_id_submission_id_key";
ALTER TABLE "process"."process_task" DROP COLUMN "form_revision_id";
ALTER TABLE "process"."process_instance" DROP COLUMN "submission_id";
