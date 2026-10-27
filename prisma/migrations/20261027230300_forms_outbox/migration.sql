-- Slice 2.6: the forms module's outbox (ADR-0006), for forms.submission-received.v1. The same
-- shape as every module outbox (probe.outbox, scripts/check-prisma-boundaries.mjs).

-- CreateTable
CREATE TABLE "forms"."outbox" (
    "event_id" UUID NOT NULL,
    "type" VARCHAR(128) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "causation_id" UUID,
    "payload" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_tenant_id_aggregate_id_aggregate_version_key" ON "forms"."outbox"("tenant_id", "aggregate_id", "aggregate_version");

-- Hand-written: the integrity backstops Prisma cannot express, as in probe.outbox (the type
-- names this module only).
ALTER TABLE "forms"."outbox"
  ADD CONSTRAINT "outbox_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "outbox_type_check" CHECK ("type" ~ '^forms\.[a-z0-9-]+\.v[1-9][0-9]*$'),
  ADD CONSTRAINT "outbox_aggregate_type_check" CHECK ("aggregate_type" ~ '^[a-z][a-z0-9-]*$'),
  ADD CONSTRAINT "outbox_aggregate_version_check" CHECK ("aggregate_version" >= 1),
  ADD CONSTRAINT "outbox_correlation_id_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9._-]{8,128}$'),
  ADD CONSTRAINT "outbox_payload_check" CHECK (jsonb_typeof("payload") = 'object');

-- Hand-written: the relay's claim index, partial so it holds only the rows still to publish.
CREATE INDEX "outbox_tenant_id_event_id_unpublished_idx" ON "forms"."outbox" ("tenant_id", "event_id") WHERE "published_at" IS NULL;

-- Grants: an outbox row changes only its published_at.
GRANT SELECT, INSERT, UPDATE ("published_at") ON TABLE "forms"."outbox" TO "phoenix_app";

-- Row-level security (ADR-0002), enabled and forced, with the reference policy. The relay runs
-- as the application login too, one tenant per transaction.
ALTER TABLE "forms"."outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forms"."outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outbox_tenant_isolation" ON "forms"."outbox"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
