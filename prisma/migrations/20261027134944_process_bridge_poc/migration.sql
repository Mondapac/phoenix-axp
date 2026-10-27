-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "process";

-- CreateTable
CREATE TABLE "process"."form_revision" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "form_key" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL,
    "json_schema" JSONB NOT NULL,
    "ui_schema" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "form_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process"."process_revision" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "process_key" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL,
    "bpmn_xml" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "process_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process"."request" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "requester_id" UUID NOT NULL,
    "form_revision_id" UUID NOT NULL,
    "process_revision_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "process_instance_id" VARCHAR(64),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process"."task" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "request_id" UUID NOT NULL,
    "engine_task_id" VARCHAR(64) NOT NULL,
    "task_key" VARCHAR(64) NOT NULL,
    "form_key" VARCHAR(64) NOT NULL,
    "assignee_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "decision" VARCHAR(16),
    "completion_key" UUID,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process"."outbox" (
    "event_id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "type" VARCHAR(96) NOT NULL,
    "aggregate_type" VARCHAR(32) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,
    "lease_until" TIMESTAMPTZ(3),
    "last_error" VARCHAR(64),
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "process"."inbox" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "event_id" UUID NOT NULL,
    "handler" VARCHAR(64) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbox_pkey" PRIMARY KEY ("tenant_id","event_id","handler")
);

-- CreateTable
CREATE TABLE "process"."incident" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "engine_ref" VARCHAR(64) NOT NULL,
    "request_id" UUID,
    "detected_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_revision_tenant_id_form_key_revision_key" ON "process"."form_revision"("tenant_id", "form_key", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "process_revision_tenant_id_process_key_revision_key" ON "process"."process_revision"("tenant_id", "process_key", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "request_tenant_id_process_instance_id_key" ON "process"."request"("tenant_id", "process_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_tenant_id_engine_task_id_key" ON "process"."task"("tenant_id", "engine_task_id");

-- Hand-written (PoC 3 spike; database-designer review pending before Phase 2): integrity
-- backstops Prisma cannot express. The tenant pattern repeats the kernel's parseTenantId.
ALTER TABLE "process"."form_revision"
  ADD CONSTRAINT "form_revision_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "form_revision_revision_check" CHECK ("revision" >= 1);
ALTER TABLE "process"."process_revision"
  ADD CONSTRAINT "process_revision_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "process_revision_revision_check" CHECK ("revision" >= 1);
ALTER TABLE "process"."request"
  ADD CONSTRAINT "request_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "request_status_check" CHECK ("status" IN ('submitted', 'running', 'approved', 'rejected', 'cancelled')),
  ADD CONSTRAINT "request_version_check" CHECK ("version" >= 1);
ALTER TABLE "process"."task"
  ADD CONSTRAINT "task_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "task_status_check" CHECK ("status" IN ('open', 'completing', 'completed', 'superseded', 'escalated', 'cancelled')),
  ADD CONSTRAINT "task_decision_check" CHECK ("decision" IS NULL OR "decision" IN ('approve', 'reject')),
  ADD CONSTRAINT "task_completing_check" CHECK ("status" <> 'completing' OR ("decision" IS NOT NULL AND "completion_key" IS NOT NULL)),
  ADD CONSTRAINT "task_version_check" CHECK ("version" >= 1);
ALTER TABLE "process"."outbox"
  ADD CONSTRAINT "outbox_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "outbox_type_check" CHECK ("type" ~ '^process\.[a-z0-9-]+\.v[1-9][0-9]*$'),
  ADD CONSTRAINT "outbox_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "outbox_payload_check" CHECK (jsonb_typeof("payload") = 'object');
ALTER TABLE "process"."inbox"
  ADD CONSTRAINT "inbox_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "inbox_handler_check" CHECK ("handler" ~ '^process\.[a-z0-9-]+$');
ALTER TABLE "process"."incident"
  ADD CONSTRAINT "incident_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');

-- The relay's claim: unpublished rows of one tenant, in event order.
CREATE INDEX "outbox_tenant_id_event_id_unpublished_idx" ON "process"."outbox" ("tenant_id", "event_id") WHERE "published_at" IS NULL;

-- Grants. Revisions and the incident log are append-only for the application; the inbox is
-- insert-only.
GRANT USAGE ON SCHEMA "process" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "process"."form_revision", "process"."process_revision", "process"."incident", "process"."inbox" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE ON TABLE "process"."request", "process"."task" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE ("attempts", "lease_until", "last_error", "published_at") ON TABLE "process"."outbox" TO "phoenix_app";

-- Row-level security: the reference policy of platform.isolation_probe on every table.
ALTER TABLE "process"."form_revision" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "form_revision_tenant_isolation" ON "process"."form_revision" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "process"."process_revision" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "process_revision_tenant_isolation" ON "process"."process_revision" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "process"."request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "request_tenant_isolation" ON "process"."request" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "process"."task" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_tenant_isolation" ON "process"."task" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "process"."outbox" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outbox_tenant_isolation" ON "process"."outbox" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "process"."inbox" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inbox_tenant_isolation" ON "process"."inbox" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "process"."incident" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incident_tenant_isolation" ON "process"."incident" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
