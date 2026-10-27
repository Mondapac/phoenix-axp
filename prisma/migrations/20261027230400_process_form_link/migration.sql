-- Slice 2.6: the link between forms and processes. A process revision pins, at publish, the
-- form revision its start event and each user task name; a form starts at most one process
-- key; an instance records the submission that started it (one instance per submission); a
-- task records the form revision it shows; and the module's event inbox (ADR-0006).

-- AlterTable
ALTER TABLE "process"."process_instance" ADD COLUMN     "submission_id" UUID;

-- AlterTable
ALTER TABLE "process"."process_task" ADD COLUMN     "form_revision_id" UUID;

-- CreateTable
CREATE TABLE "process"."process_form_binding" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "revision_id" UUID NOT NULL,
    "element_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "form_id" UUID NOT NULL,
    "form_revision_id" UUID NOT NULL,

    CONSTRAINT "process_form_binding_pkey" PRIMARY KEY ("tenant_id","revision_id","element_id")
);

-- CreateTable
CREATE TABLE "process"."process_start_form" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "form_id" UUID NOT NULL,
    "process_key" VARCHAR(64) NOT NULL,
    "claimed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "process_start_form_pkey" PRIMARY KEY ("tenant_id","form_id")
);

-- CreateTable
CREATE TABLE "process"."inbox" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "event_id" UUID NOT NULL,
    "handler" VARCHAR(96) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbox_pkey" PRIMARY KEY ("tenant_id","event_id","handler")
);

-- CreateIndex
CREATE UNIQUE INDEX "process_instance_tenant_id_submission_id_key" ON "process"."process_instance"("tenant_id", "submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "process_start_form_tenant_id_process_key_key" ON "process"."process_start_form"("tenant_id", "process_key");

-- One start form per revision, behind the guard (partial: not expressible in the Prisma schema).
CREATE UNIQUE INDEX "process_form_binding_tenant_id_revision_id_start_key" ON "process"."process_form_binding" ("tenant_id", "revision_id") WHERE "kind" = 'start';

-- AddForeignKey
ALTER TABLE "process"."process_form_binding" ADD CONSTRAINT "process_form_binding_revision_fkey" FOREIGN KEY ("tenant_id", "revision_id") REFERENCES "process"."process_revision"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Hand-written: integrity backstops Prisma cannot express. The new tables are empty, so their
-- CHECKs validate at once; the two new columns are null on every existing row.
ALTER TABLE "process"."process_form_binding"
  ADD CONSTRAINT "process_form_binding_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "process_form_binding_element_id_check" CHECK ("element_id" ~ '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$'),
  ADD CONSTRAINT "process_form_binding_kind_check" CHECK ("kind" IN ('start', 'task'));

ALTER TABLE "process"."process_start_form"
  ADD CONSTRAINT "process_start_form_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "process_start_form_process_key_check" CHECK ("process_key" ~ '^[A-Za-z_][A-Za-z0-9_-]{0,63}$');

ALTER TABLE "process"."inbox"
  ADD CONSTRAINT "inbox_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "inbox_handler_check" CHECK ("handler" ~ '^process\.[a-z0-9-]+$');

-- Grants: bindings, start forms and the inbox are insert-only; the new columns are written
-- once, at insert, so no UPDATE grant changes.
GRANT SELECT, INSERT ON TABLE "process"."process_form_binding" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "process"."process_start_form" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "process"."inbox" TO "phoenix_app";

-- Row-level security (ADR-0002), enabled and forced, with the reference policy.
ALTER TABLE "process"."process_form_binding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."process_form_binding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "process_form_binding_tenant_isolation" ON "process"."process_form_binding"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "process"."process_start_form" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."process_start_form" FORCE ROW LEVEL SECURITY;
CREATE POLICY "process_start_form_tenant_isolation" ON "process"."process_start_form"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "process"."inbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."inbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inbox_tenant_isolation" ON "process"."inbox"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
