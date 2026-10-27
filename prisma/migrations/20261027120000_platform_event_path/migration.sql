-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "probe";

-- CreateTable
CREATE TABLE "platform"."event_delivery" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "event_id" UUID NOT NULL,
    "subscriber" VARCHAR(96) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "type" VARCHAR(128) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "causation_id" UUID,
    "payload" JSONB NOT NULL,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "dead_at" TIMESTAMPTZ(3),

    CONSTRAINT "event_delivery_pkey" PRIMARY KEY ("tenant_id","event_id","subscriber")
);

-- CreateTable
CREATE TABLE "probe"."outbox" (
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

-- CreateTable
CREATE TABLE "probe"."inbox" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "event_id" UUID NOT NULL,
    "handler" VARCHAR(96) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbox_pkey" PRIMARY KEY ("tenant_id","event_id","handler")
);

-- CreateTable
CREATE TABLE "probe"."receipt" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "event_id" UUID NOT NULL,
    "thing_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("tenant_id","event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_tenant_id_aggregate_id_aggregate_version_key" ON "probe"."outbox"("tenant_id", "aggregate_id", "aggregate_version");


-- Hand-written: the integrity backstops Prisma cannot express (ported from Mondapac's
-- 20261008051645_platform_event_delivery and 20261007120000_identity_outbox, Market adapted to
-- Tenant). The tenant pattern repeats the kernel's single rule (parseTenantId); a code column
-- holds lower-case segments joined by "." (delivery.not-consumed).
ALTER TABLE "platform"."event_delivery"
  ADD CONSTRAINT "event_delivery_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "event_delivery_subscriber_check" CHECK ("subscriber" ~ '^[a-z][a-z0-9-]*\.[a-z0-9-]+$'),
  ADD CONSTRAINT "event_delivery_status_check" CHECK ("status" IN ('pending', 'delivered', 'dead')),
  ADD CONSTRAINT "event_delivery_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "event_delivery_type_check" CHECK ("type" ~ '^[a-z][a-z0-9-]*\.[a-z0-9-]+\.v[1-9][0-9]*$'),
  ADD CONSTRAINT "event_delivery_aggregate_type_check" CHECK ("aggregate_type" ~ '^[a-z][a-z0-9-]*$'),
  ADD CONSTRAINT "event_delivery_aggregate_version_check" CHECK ("aggregate_version" >= 1),
  ADD CONSTRAINT "event_delivery_correlation_id_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9._-]{8,128}$'),
  ADD CONSTRAINT "event_delivery_payload_check" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "event_delivery_error_code_check" CHECK ("error_code" ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$'),
  ADD CONSTRAINT "event_delivery_delivered_check" CHECK (("status" = 'delivered') = ("delivered_at" IS NOT NULL)),
  ADD CONSTRAINT "event_delivery_dead_check" CHECK (("status" = 'dead') = ("dead_at" IS NOT NULL));

ALTER TABLE "probe"."outbox"
  ADD CONSTRAINT "outbox_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "outbox_type_check" CHECK ("type" ~ '^probe\.[a-z0-9-]+\.v[1-9][0-9]*$'),
  ADD CONSTRAINT "outbox_aggregate_type_check" CHECK ("aggregate_type" ~ '^[a-z][a-z0-9-]*$'),
  ADD CONSTRAINT "outbox_aggregate_version_check" CHECK ("aggregate_version" >= 1),
  ADD CONSTRAINT "outbox_correlation_id_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9._-]{8,128}$'),
  ADD CONSTRAINT "outbox_payload_check" CHECK (jsonb_typeof("payload") = 'object');

ALTER TABLE "probe"."inbox"
  ADD CONSTRAINT "inbox_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "inbox_handler_check" CHECK ("handler" ~ '^probe\.[a-z0-9-]+$');

ALTER TABLE "probe"."receipt"
  ADD CONSTRAINT "receipt_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');

-- Hand-written: the claim indexes of the relay and the dispatcher, partial so they hold only
-- the rows still to be handled. Invisible to Prisma.
CREATE INDEX "outbox_tenant_id_event_id_unpublished_idx" ON "probe"."outbox" ("tenant_id", "event_id") WHERE "published_at" IS NULL;
CREATE INDEX "event_delivery_tenant_id_next_attempt_at_pending_idx" ON "platform"."event_delivery" ("tenant_id", "next_attempt_at") WHERE "status" = 'pending';

-- Grants. The envelope copies are immutable to the application: an outbox row changes only its
-- published_at, a delivery row only its status columns.
GRANT SELECT, INSERT, UPDATE ("status", "attempts", "next_attempt_at", "error_code", "delivered_at", "dead_at") ON TABLE "platform"."event_delivery" TO "phoenix_app";
GRANT USAGE ON SCHEMA "probe" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE ("published_at") ON TABLE "probe"."outbox" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "probe"."inbox" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "probe"."receipt" TO "phoenix_app";

-- Row-level security (ADR-02), the reference policy of platform.isolation_probe on every new
-- table. The relay and the dispatcher run as the application login too, so they set
-- app.tenant_id in each transaction, one tenant at a time.
ALTER TABLE "platform"."event_delivery" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_delivery_tenant_isolation" ON "platform"."event_delivery"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "probe"."outbox" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outbox_tenant_isolation" ON "probe"."outbox"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "probe"."inbox" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inbox_tenant_isolation" ON "probe"."inbox"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "probe"."receipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receipt_tenant_isolation" ON "probe"."receipt"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
