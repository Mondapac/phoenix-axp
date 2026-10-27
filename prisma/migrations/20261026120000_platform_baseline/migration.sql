-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateTable
CREATE TABLE "platform"."isolation_probe" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "label" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "isolation_probe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "isolation_probe_tenant_id_label_key" ON "platform"."isolation_probe"("tenant_id", "label");

-- Hand-written: integrity backstops Prisma cannot express. The tenant pattern repeats the
-- kernel's single rule (parseTenantId).
ALTER TABLE "platform"."isolation_probe"
  ADD CONSTRAINT "isolation_probe_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "isolation_probe_label_check" CHECK ("label" ~ '^[a-z0-9]+([.-][a-z0-9]+)*$');

-- Grants. The group role "phoenix_app" is created by the cluster bootstrap, never by a
-- migration; without it this migration fails with 42704, on purpose.
GRANT USAGE ON SCHEMA "platform" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "platform"."isolation_probe" TO "phoenix_app";
