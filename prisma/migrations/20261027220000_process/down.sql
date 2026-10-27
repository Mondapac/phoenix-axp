-- Reverses 20261027220000_process: the policies and grants first, then the tables (their
-- CHECKs, indexes and foreign keys go with them), then the schema.
DROP POLICY "process_incident_tenant_isolation" ON "process"."process_incident";
DROP POLICY "engine_sync_state_tenant_isolation" ON "process"."engine_sync_state";
DROP POLICY "engine_observation_tenant_isolation" ON "process"."engine_observation";
DROP POLICY "engine_command_tenant_isolation" ON "process"."engine_command";
DROP POLICY "process_task_tenant_isolation" ON "process"."process_task";
DROP POLICY "process_instance_tenant_isolation" ON "process"."process_instance";
DROP POLICY "process_revision_tenant_isolation" ON "process"."process_revision";

REVOKE ALL ON TABLE "process"."process_incident" FROM "phoenix_app";
REVOKE ALL ON TABLE "process"."engine_sync_state" FROM "phoenix_app";
REVOKE ALL ON TABLE "process"."engine_observation" FROM "phoenix_app";
REVOKE ALL ON TABLE "process"."engine_command" FROM "phoenix_app";
REVOKE ALL ON TABLE "process"."process_task" FROM "phoenix_app";
REVOKE ALL ON TABLE "process"."process_instance" FROM "phoenix_app";
REVOKE ALL ON TABLE "process"."process_revision" FROM "phoenix_app";
REVOKE USAGE ON SCHEMA "process" FROM "phoenix_app";

DROP TABLE "process"."process_incident";
DROP TABLE "process"."engine_sync_state";
DROP TABLE "process"."engine_observation";
DROP TABLE "process"."engine_command";
DROP TABLE "process"."process_task";
DROP TABLE "process"."process_instance";
DROP TABLE "process"."process_revision";
DROP SCHEMA "process";
