-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "process";

-- CreateTable
CREATE TABLE "process"."process_revision" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "process_key" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL,
    "bpmn_xml" TEXT NOT NULL,
    "content_hash" VARCHAR(71) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "process_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process"."process_instance" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "revision_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "engine_instance_id" VARCHAR(64),
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL,

    CONSTRAINT "process_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process"."process_task" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "instance_id" UUID NOT NULL,
    "engine_task_id" VARCHAR(64) NOT NULL,
    "task_key" VARCHAR(255) NOT NULL,
    "form_key" VARCHAR(255),
    "status" VARCHAR(16) NOT NULL,
    "completion_key" UUID,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL,

    CONSTRAINT "process_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process"."engine_command" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "subject_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "not_before" TIMESTAMPTZ(3) NOT NULL,
    "last_error" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "dead_at" TIMESTAMPTZ(3),

    CONSTRAINT "engine_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process"."engine_observation" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "event_id" UUID NOT NULL,
    "handler" VARCHAR(64) NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "engine_observation_pkey" PRIMARY KEY ("tenant_id","event_id","handler")
);

-- CreateTable
CREATE TABLE "process"."engine_sync_state" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "tasks_ended_after" TIMESTAMPTZ(3),
    "instances_ended_after" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "engine_sync_state_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "process"."process_incident" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "engine_ref" VARCHAR(64) NOT NULL,
    "instance_id" UUID,
    "detected_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "process_incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "process_revision_tenant_id_id_key" ON "process"."process_revision"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "process_revision_tenant_id_process_key_revision_key" ON "process"."process_revision"("tenant_id", "process_key", "revision");

-- CreateIndex
CREATE INDEX "process_instance_tenant_id_revision_id_idx" ON "process"."process_instance"("tenant_id", "revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "process_instance_tenant_id_id_key" ON "process"."process_instance"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "process_instance_tenant_id_engine_instance_id_key" ON "process"."process_instance"("tenant_id", "engine_instance_id");

-- CreateIndex
CREATE INDEX "process_task_tenant_id_instance_id_idx" ON "process"."process_task"("tenant_id", "instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "process_task_tenant_id_engine_task_id_key" ON "process"."process_task"("tenant_id", "engine_task_id");

-- CreateIndex
CREATE INDEX "engine_command_tenant_id_subject_id_idx" ON "process"."engine_command"("tenant_id", "subject_id");

-- CreateIndex
CREATE INDEX "process_incident_tenant_id_detected_at_idx" ON "process"."process_incident"("tenant_id", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "process_incident_tenant_id_kind_engine_ref_key" ON "process"."process_incident"("tenant_id", "kind", "engine_ref");

-- AddForeignKey
ALTER TABLE "process"."process_instance" ADD CONSTRAINT "process_instance_revision_fkey" FOREIGN KEY ("tenant_id", "revision_id") REFERENCES "process"."process_revision"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "process"."process_task" ADD CONSTRAINT "process_task_instance_fkey" FOREIGN KEY ("tenant_id", "instance_id") REFERENCES "process"."process_instance"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written: integrity backstops Prisma cannot express. The tenant pattern repeats the
-- kernel's single rule (parseTenantId); the others repeat the module's domain rules.
ALTER TABLE "process"."process_revision"
  ADD CONSTRAINT "process_revision_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "process_revision_process_key_check" CHECK ("process_key" ~ '^[A-Za-z_][A-Za-z0-9_-]{0,63}$'),
  ADD CONSTRAINT "process_revision_revision_check" CHECK ("revision" >= 1),
  ADD CONSTRAINT "process_revision_bpmn_xml_check" CHECK (octet_length("bpmn_xml") BETWEEN 1 AND 1048576),
  ADD CONSTRAINT "process_revision_content_hash_check" CHECK ("content_hash" ~ '^sha256:[0-9a-f]{64}$');

ALTER TABLE "process"."process_instance"
  ADD CONSTRAINT "process_instance_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "process_instance_status_check" CHECK ("status" IN ('starting', 'running', 'completed', 'cancelled')),
  ADD CONSTRAINT "process_instance_engine_instance_id_check" CHECK ("engine_instance_id" ~ '^[A-Za-z0-9._:-]{1,64}$'),
  ADD CONSTRAINT "process_instance_adopted_check" CHECK (("status" = 'starting') = ("engine_instance_id" IS NULL)),
  ADD CONSTRAINT "process_instance_ended_check" CHECK (("status" IN ('completed', 'cancelled')) = ("ended_at" IS NOT NULL)),
  ADD CONSTRAINT "process_instance_version_check" CHECK ("version" >= 1);

ALTER TABLE "process"."process_task"
  ADD CONSTRAINT "process_task_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "process_task_engine_task_id_check" CHECK ("engine_task_id" ~ '^[A-Za-z0-9._:-]{1,64}$'),
  ADD CONSTRAINT "process_task_task_key_check" CHECK (char_length("task_key") > 0),
  ADD CONSTRAINT "process_task_status_check" CHECK ("status" IN ('open', 'completing', 'completed', 'superseded', 'escalated', 'cancelled')),
  ADD CONSTRAINT "process_task_completion_key_check" CHECK ("status" <> 'completing' OR "completion_key" IS NOT NULL),
  ADD CONSTRAINT "process_task_closed_check" CHECK (("status" IN ('open', 'completing')) = ("closed_at" IS NULL)),
  ADD CONSTRAINT "process_task_version_check" CHECK ("version" >= 1);

ALTER TABLE "process"."engine_command"
  ADD CONSTRAINT "engine_command_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "engine_command_kind_check" CHECK ("kind" IN ('deploy-revision', 'start-instance', 'complete-task', 'delete-orphan')),
  ADD CONSTRAINT "engine_command_payload_check" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "engine_command_correlation_id_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9._-]{8,128}$'),
  ADD CONSTRAINT "engine_command_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "engine_command_last_error_check" CHECK ("last_error" ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$'),
  ADD CONSTRAINT "engine_command_settled_check" CHECK ("published_at" IS NULL OR "dead_at" IS NULL);

ALTER TABLE "process"."engine_observation"
  ADD CONSTRAINT "engine_observation_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "engine_observation_handler_check" CHECK ("handler" ~ '^process\.[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "process"."engine_sync_state"
  ADD CONSTRAINT "engine_sync_state_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "engine_sync_state_version_check" CHECK ("version" >= 1);

ALTER TABLE "process"."process_incident"
  ADD CONSTRAINT "process_incident_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "process_incident_kind_check" CHECK ("kind" IN ('orphan-instance', 'completed-outside-core', 'completion-superseded', 'unknown-instance', 'command-refused')),
  ADD CONSTRAINT "process_incident_engine_ref_check" CHECK ("engine_ref" ~ '^[A-Za-z0-9._:-]{1,64}$');

-- Hand-written: the relay's claim index, partial so it holds only the commands still to send.
-- Invisible to Prisma.
CREATE INDEX "engine_command_tenant_id_not_before_pending_idx" ON "process"."engine_command" ("tenant_id", "not_before") WHERE "published_at" IS NULL AND "dead_at" IS NULL;
CREATE INDEX "process_task_tenant_id_open_idx" ON "process"."process_task" ("tenant_id", "id") WHERE "status" IN ('open', 'completing');

-- Grants. The group role "phoenix_app" is created by the cluster bootstrap, never by a
-- migration. Revisions, observations and incidents are insert-only (V1, inbox, V4); no table
-- of this module grants DELETE.
GRANT USAGE ON SCHEMA "process" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "process"."process_revision" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE ("status", "engine_instance_id", "ended_at", "version") ON TABLE "process"."process_instance" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE ("status", "completion_key", "closed_at", "version") ON TABLE "process"."process_task" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE ("attempts", "not_before", "last_error", "published_at", "dead_at") ON TABLE "process"."engine_command" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "process"."engine_observation" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE ("tasks_ended_after", "instances_ended_after", "version", "updated_at") ON TABLE "process"."engine_sync_state" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "process"."process_incident" TO "phoenix_app";

-- Row-level security (ADR-0002), enabled and forced, with the reference policy of
-- platform.isolation_probe on every table. The relay and the sync run as the application login
-- too, one tenant per transaction.

ALTER TABLE "process"."process_revision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."process_revision" FORCE ROW LEVEL SECURITY;
CREATE POLICY "process_revision_tenant_isolation" ON "process"."process_revision"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "process"."process_instance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."process_instance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "process_instance_tenant_isolation" ON "process"."process_instance"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "process"."process_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."process_task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "process_task_tenant_isolation" ON "process"."process_task"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "process"."engine_command" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."engine_command" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engine_command_tenant_isolation" ON "process"."engine_command"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "process"."engine_observation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."engine_observation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engine_observation_tenant_isolation" ON "process"."engine_observation"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "process"."engine_sync_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."engine_sync_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engine_sync_state_tenant_isolation" ON "process"."engine_sync_state"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "process"."process_incident" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."process_incident" FORCE ROW LEVEL SECURITY;
CREATE POLICY "process_incident_tenant_isolation" ON "process"."process_incident"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
