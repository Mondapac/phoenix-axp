-- Reverses 20261030190000_process_decisions: the old command kind CHECK, then the policy, the
-- grants and the table (its CHECKs and indexes go with it). The CHECK is NOT VALID: commands of
-- the dropped kind stay as history and are never claimed again; new rows are checked.
ALTER TABLE "process"."engine_command" DROP CONSTRAINT "engine_command_kind_check";
ALTER TABLE "process"."engine_command"
  ADD CONSTRAINT "engine_command_kind_check" CHECK ("kind" IN ('deploy-revision', 'start-instance', 'complete-task', 'delete-orphan')) NOT VALID;

DROP POLICY "decision_revision_tenant_isolation" ON "process"."decision_revision";
REVOKE ALL ON TABLE "process"."decision_revision" FROM "phoenix_app";
DROP TABLE "process"."decision_revision";
