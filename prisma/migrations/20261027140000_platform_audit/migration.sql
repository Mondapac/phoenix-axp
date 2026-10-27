-- Phoenix ADR-0015: the append-only audit log and its per-tenant hash chain.
-- CreateTable
CREATE TABLE "platform"."audit_log" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_type" VARCHAR(16) NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(128) NOT NULL,
    "target_type" VARCHAR(128) NOT NULL,
    "target_id" VARCHAR(128) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "correlation_id" VARCHAR(128) NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "platform"."audit_log_seal" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "epoch" INTEGER NOT NULL,
    "chain_seq" BIGINT NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "audit_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "row_hash" BYTEA NOT NULL,
    "chain_hash" BYTEA NOT NULL,
    "late" BOOLEAN NOT NULL,
    "hash_version" SMALLINT NOT NULL,
    "sealed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_log_seal_pkey" PRIMARY KEY ("tenant_id","epoch","chain_seq")
);

-- CreateTable
CREATE TABLE "platform"."audit_chain_checkpoint" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "epoch" INTEGER NOT NULL,
    "chain_seq" BIGINT NOT NULL,
    "chain_hash" BYTEA NOT NULL,
    "hash_version" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_chain_checkpoint_pkey" PRIMARY KEY ("tenant_id","epoch","chain_seq")
);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_target_type_target_id_occurred_at_idx" ON "platform"."audit_log"("tenant_id", "target_type", "target_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_actor_id_occurred_at_idx" ON "platform"."audit_log"("tenant_id", "actor_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_tenant_id_occurred_at_id_key" ON "platform"."audit_log"("tenant_id", "occurred_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_seal_tenant_id_epoch_occurred_at_id_key" ON "platform"."audit_log_seal"("tenant_id", "epoch", "audit_occurred_at", "audit_log_id");

-- AddForeignKey
ALTER TABLE "platform"."audit_log_seal" ADD CONSTRAINT "audit_log_seal_tenant_id_audit_occurred_at_audit_log_id_fkey" FOREIGN KEY ("tenant_id", "audit_occurred_at", "audit_log_id") REFERENCES "platform"."audit_log"("tenant_id", "occurred_at", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written: integrity backstops Prisma cannot express (ported from Mondapac's baseline and
-- 20261008140000_platform_audit_seal, Market adapted to Tenant; no acting_as_id).
ALTER TABLE "platform"."audit_log"
  ADD CONSTRAINT "audit_log_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "audit_log_actor_type_check" CHECK ("actor_type" IN ('USER', 'SYSTEM', 'ANONYMOUS')),
  ADD CONSTRAINT "audit_log_actor_check" CHECK (("actor_type" = 'USER') = ("actor_id" IS NOT NULL)),
  ADD CONSTRAINT "audit_log_action_check" CHECK ("action" ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
  ADD CONSTRAINT "audit_log_target_type_check" CHECK ("target_type" ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
  ADD CONSTRAINT "audit_log_target_id_check" CHECK (char_length("target_id") >= 1),
  ADD CONSTRAINT "audit_log_before_check" CHECK ("before" IS NULL OR jsonb_typeof("before") = 'object'),
  ADD CONSTRAINT "audit_log_after_check" CHECK ("after" IS NULL OR jsonb_typeof("after") = 'object'),
  ADD CONSTRAINT "audit_log_before_size_check" CHECK (octet_length("before"::text) <= 8192),
  ADD CONSTRAINT "audit_log_after_size_check" CHECK (octet_length("after"::text) <= 8192),
  ADD CONSTRAINT "audit_log_correlation_id_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9._-]{8,128}$');

ALTER TABLE "platform"."audit_log_seal"
  ADD CONSTRAINT "audit_log_seal_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "audit_log_seal_epoch_check" CHECK ("epoch" >= 1),
  ADD CONSTRAINT "audit_log_seal_chain_seq_check" CHECK ("chain_seq" >= 1),
  ADD CONSTRAINT "audit_log_seal_genesis_check" CHECK ("epoch" > 1 OR "chain_seq" > 1 OR NOT "late"),
  ADD CONSTRAINT "audit_log_seal_row_hash_check" CHECK (octet_length("row_hash") = 32),
  ADD CONSTRAINT "audit_log_seal_chain_hash_check" CHECK (octet_length("chain_hash") = 32),
  ADD CONSTRAINT "audit_log_seal_hash_version_check" CHECK ("hash_version" IN (1));

ALTER TABLE "platform"."audit_chain_checkpoint"
  ADD CONSTRAINT "audit_chain_checkpoint_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT "audit_chain_checkpoint_epoch_check" CHECK ("epoch" >= 1),
  ADD CONSTRAINT "audit_chain_checkpoint_chain_seq_check" CHECK ("chain_seq" >= 1),
  ADD CONSTRAINT "audit_chain_checkpoint_chain_hash_check" CHECK (octet_length("chain_hash") = 32),
  ADD CONSTRAINT "audit_chain_checkpoint_hash_version_check" CHECK ("hash_version" IN (1));

-- Hand-written: append-only for every role, the owner included (Phoenix ADR-0015 decision 1).
CREATE FUNCTION "platform"."audit_reject_mutation"() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "platform"."audit_log"
  FOR EACH ROW EXECUTE FUNCTION "platform"."audit_reject_mutation"();
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "platform"."audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "platform"."audit_reject_mutation"();
CREATE TRIGGER "audit_log_seal_no_update_delete"
  BEFORE UPDATE OR DELETE ON "platform"."audit_log_seal"
  FOR EACH ROW EXECUTE FUNCTION "platform"."audit_reject_mutation"();
CREATE TRIGGER "audit_log_seal_no_truncate"
  BEFORE TRUNCATE ON "platform"."audit_log_seal"
  FOR EACH STATEMENT EXECUTE FUNCTION "platform"."audit_reject_mutation"();
CREATE TRIGGER "audit_chain_checkpoint_no_update_delete"
  BEFORE UPDATE OR DELETE ON "platform"."audit_chain_checkpoint"
  FOR EACH ROW EXECUTE FUNCTION "platform"."audit_reject_mutation"();
CREATE TRIGGER "audit_chain_checkpoint_no_truncate"
  BEFORE TRUNCATE ON "platform"."audit_chain_checkpoint"
  FOR EACH STATEMENT EXECUTE FUNCTION "platform"."audit_reject_mutation"();

-- Grants: INSERT and SELECT only (ADR-0015 decision 1).
GRANT SELECT, INSERT ON TABLE "platform"."audit_log" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "platform"."audit_log_seal" TO "phoenix_app";
GRANT SELECT, INSERT ON TABLE "platform"."audit_chain_checkpoint" TO "phoenix_app";

-- Row-level security (ADR-0002): the chain is per tenant, and the sealer and the verifier run
-- in a unit of one tenant, so each sees only that tenant's rows.
ALTER TABLE "platform"."audit_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_tenant_isolation" ON "platform"."audit_log"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "platform"."audit_log_seal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_seal_tenant_isolation" ON "platform"."audit_log_seal"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());

ALTER TABLE "platform"."audit_chain_checkpoint" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_chain_checkpoint_tenant_isolation" ON "platform"."audit_chain_checkpoint"
  AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"())
  WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
