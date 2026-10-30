-- Phase 2 slice 2.10 (studio modeler, owner decision D7): the working copy a designer saves
-- before a publisher publishes it. Prisma's diff, then the hand-written CHECKs, grants and
-- row-level security.

-- CreateTable
CREATE TABLE "process"."process_draft" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "process_key" VARCHAR(64) NOT NULL,
    "bpmn_xml" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "process_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "process_draft_tenant_id_id_key" ON "process"."process_draft"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "process_draft_tenant_id_process_key_key" ON "process"."process_draft"("tenant_id", "process_key");

-- CHECKs (Prisma does not model them): the kernel's tenant rule and the module's own rules.
ALTER TABLE "process"."process_draft"
  ADD CONSTRAINT "process_draft_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "process_draft_process_key_check" CHECK ("process_key" ~ '^[A-Za-z_][A-Za-z0-9_-]{0,63}$'),
  ADD CONSTRAINT "process_draft_bpmn_xml_check" CHECK (octet_length("bpmn_xml") BETWEEN 1 AND 1048576),
  ADD CONSTRAINT "process_draft_version_check" CHECK ("version" >= 1);

-- Grants: a draft is overwritten in place; never deleted.
GRANT SELECT, INSERT, UPDATE ("bpmn_xml", "version", "updated_at") ON TABLE "process"."process_draft" TO "phoenix_app";

ALTER TABLE "process"."process_draft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."process_draft" FORCE ROW LEVEL SECURITY;
CREATE POLICY "process_draft_tenant_isolation" ON "process"."process_draft"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
