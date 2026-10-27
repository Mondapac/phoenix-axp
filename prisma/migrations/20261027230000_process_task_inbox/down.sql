-- Reverses 20261027230000_process_task_inbox: the policy and grants first, then the calendar
-- table, the partial index, the CHECKs and the added columns.
DROP POLICY "working_calendar_tenant_isolation" ON "process"."working_calendar";
REVOKE ALL ON TABLE "process"."working_calendar" FROM "phoenix_app";
REVOKE UPDATE ("candidate_role_id", "assignee_account_id", "escalated_at", "outcome") ON TABLE "process"."process_task" FROM "phoenix_app";

DROP TABLE "process"."working_calendar";

DROP INDEX "process"."process_task_tenant_id_escalation_due_idx";
DROP INDEX "process"."process_task_tenant_id_candidate_role_id_idx";
DROP INDEX "process"."process_task_tenant_id_assignee_account_id_idx";

ALTER TABLE "process"."process_task"
  DROP CONSTRAINT "process_task_outcome_check",
  DROP CONSTRAINT "process_task_outcomes_check",
  DROP CONSTRAINT "process_task_escalation_due_check",
  DROP CONSTRAINT "process_task_escalation_check",
  DROP CONSTRAINT "process_task_name_check",
  DROP COLUMN "site_id",
  DROP COLUMN "outcomes",
  DROP COLUMN "outcome",
  DROP COLUMN "name",
  DROP COLUMN "escalation_role_id",
  DROP COLUMN "escalated_at",
  DROP COLUMN "due_at",
  DROP COLUMN "candidate_role_id",
  DROP COLUMN "assignee_account_id";

ALTER TABLE "process"."process_revision"
  DROP CONSTRAINT "process_revision_task_settings_check",
  DROP COLUMN "task_settings";

ALTER TABLE "process"."process_instance" DROP COLUMN "site_id";
