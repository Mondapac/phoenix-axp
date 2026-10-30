-- Slice 2.7: DMN decision tables. A tenant publishes immutable revisions of a decision table;
-- the bridge deploys each to the engine under the tenant (command kind `deploy-decision`), and a
-- process's decision task runs the latest one of its key.

-- CreateTable
CREATE TABLE "process"."decision_revision" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "decision_key" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL,
    "dmn_xml" TEXT NOT NULL,
    "content_hash" VARCHAR(71) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "decision_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decision_revision_tenant_id_id_key" ON "process"."decision_revision"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_revision_tenant_id_decision_key_revision_key" ON "process"."decision_revision"("tenant_id", "decision_key", "revision");

-- Hand-written: integrity backstops Prisma cannot express. The table is new and empty.
ALTER TABLE "process"."decision_revision"
  ADD CONSTRAINT "decision_revision_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "decision_revision_decision_key_check" CHECK ("decision_key" ~ '^[A-Za-z_][A-Za-z0-9_-]{0,63}$'),
  ADD CONSTRAINT "decision_revision_revision_check" CHECK ("revision" >= 1),
  ADD CONSTRAINT "decision_revision_dmn_xml_check" CHECK (octet_length("dmn_xml") BETWEEN 1 AND 262144),
  ADD CONSTRAINT "decision_revision_content_hash_check" CHECK ("content_hash" ~ '^sha256:[0-9a-f]{64}$');

-- The new command kind. Existing rows hold the four older kinds, so the CHECK validates.
ALTER TABLE "process"."engine_command" DROP CONSTRAINT "engine_command_kind_check";
ALTER TABLE "process"."engine_command"
  ADD CONSTRAINT "engine_command_kind_check" CHECK ("kind" IN ('deploy-revision', 'deploy-decision', 'start-instance', 'complete-task', 'delete-orphan'));

-- Grants: a published revision is immutable, so insert-only.
GRANT SELECT, INSERT ON TABLE "process"."decision_revision" TO "phoenix_app";

-- Row-level security (ADR-0002), enabled and forced, with the reference policy.
ALTER TABLE "process"."decision_revision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "process"."decision_revision" FORCE ROW LEVEL SECURITY;
CREATE POLICY "decision_revision_tenant_isolation" ON "process"."decision_revision"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
