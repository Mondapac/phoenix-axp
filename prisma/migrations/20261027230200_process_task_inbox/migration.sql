-- Phase 2 slice 2.3 (task inbox, ADR-0025): the site of a run, the core's settings of each
-- user task of a revision, the inbox columns of a task (assignment, deadline, escalation,
-- outcome) and the tenant's working calendar (owner decision D4). Prisma's diff, then the
-- hand-written CHECKs, partial indexes, grants and row-level security.

-- AlterTable
ALTER TABLE "process"."process_instance" ADD COLUMN     "site_id" UUID;

-- AlterTable
ALTER TABLE "process"."process_revision" ADD COLUMN     "task_settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "process"."process_task" ADD COLUMN     "assignee_account_id" UUID,
ADD COLUMN     "candidate_role_id" UUID,
ADD COLUMN     "due_at" TIMESTAMPTZ(3),
ADD COLUMN     "escalated_at" TIMESTAMPTZ(3),
ADD COLUMN     "escalation_role_id" UUID,
ADD COLUMN     "name" VARCHAR(255),
ADD COLUMN     "outcome" VARCHAR(32),
ADD COLUMN     "outcomes" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],
ADD COLUMN     "site_id" UUID;

-- CreateTable
CREATE TABLE "process"."working_calendar" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "weekend_days" SMALLINT[],
    "holidays" DATE[],
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "working_calendar_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "process_task_tenant_id_assignee_account_id_idx" ON "process"."process_task"("tenant_id", "assignee_account_id");

-- CreateIndex
CREATE INDEX "process_task_tenant_id_candidate_role_id_idx" ON "process"."process_task"("tenant_id", "candidate_role_id");

-- CHECKs (Prisma does not model them). Existing rows of process_task take '{}' for outcomes
-- and NULL elsewhere, which every CHECK admits.
ALTER TABLE "process"."process_revision"
  ADD CONSTRAINT "process_revision_task_settings_check" CHECK (jsonb_typeof("task_settings") = 'object');

ALTER TABLE "process"."process_task"
  ADD CONSTRAINT "process_task_name_check" CHECK (char_length("name") BETWEEN 1 AND 255),
  ADD CONSTRAINT "process_task_escalation_check" CHECK ("escalation_role_id" IS NOT NULL OR "escalated_at" IS NULL),
  ADD CONSTRAINT "process_task_escalation_due_check" CHECK ("escalation_role_id" IS NULL OR "due_at" IS NOT NULL),
  ADD CONSTRAINT "process_task_outcomes_check" CHECK (
    "outcomes" IS NOT NULL
    AND array_position("outcomes", NULL) IS NULL
    AND cardinality("outcomes") <= 8
  ),
  ADD CONSTRAINT "process_task_outcome_check" CHECK ("outcome" ~ '^[a-z][a-z0-9-]{0,31}$');

ALTER TABLE "process"."working_calendar"
  ADD CONSTRAINT "working_calendar_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "working_calendar_weekend_days_check" CHECK (
    "weekend_days" IS NOT NULL
    AND array_position("weekend_days", NULL) IS NULL
    AND cardinality("weekend_days") <= 6
    AND "weekend_days" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]
  ),
  ADD CONSTRAINT "working_calendar_holidays_check" CHECK (
    "holidays" IS NOT NULL
    AND array_position("holidays", NULL) IS NULL
    AND cardinality("holidays") <= 1000
  ),
  ADD CONSTRAINT "working_calendar_version_check" CHECK ("version" >= 1);

-- Invisible to Prisma: the escalation job reads open tasks whose deadline will escalate.
CREATE INDEX "process_task_tenant_id_escalation_due_idx" ON "process"."process_task" ("tenant_id", "due_at") WHERE "status" = 'open' AND "escalation_role_id" IS NOT NULL AND "escalated_at" IS NULL;
-- Invisible to Prisma: the inbox lists read the open tasks in their order, by tenant and by site.
CREATE INDEX "process_task_tenant_id_open_due_idx" ON "process"."process_task" ("tenant_id", "due_at", "opened_at", "id") WHERE "status" IN ('open', 'completing');
CREATE INDEX "process_task_tenant_id_site_open_due_idx" ON "process"."process_task" ("tenant_id", "site_id", "due_at", "opened_at", "id") WHERE "status" IN ('open', 'completing');

-- Grants: the inbox changes a task's assignment, escalation and outcome; the calendar is one
-- mutable row per tenant. Still no DELETE.
GRANT UPDATE ("candidate_role_id", "assignee_account_id", "escalated_at", "outcome") ON TABLE "process"."process_task" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE ("weekend_days", "holidays", "version", "updated_at") ON TABLE "process"."working_calendar" TO "phoenix_app";

ALTER TABLE "process"."working_calendar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."working_calendar" FORCE ROW LEVEL SECURITY;
CREATE POLICY "working_calendar_tenant_isolation" ON "process"."working_calendar"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
