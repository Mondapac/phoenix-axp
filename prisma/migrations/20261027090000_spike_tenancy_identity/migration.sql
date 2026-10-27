-- SPIKE (PoC 1 and PoC 2, slices 0.6 and 0.7). Not merged: Phase 1 copies the shape.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "content";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "forms";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "site";

-- CreateTable
CREATE TABLE "content"."content_item" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "owner_site_id" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forms"."form_submission" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "site_id" UUID NOT NULL,
    "form_key" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "form_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."staff_account" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."staff_session" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "idp_session_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."role" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "permissions" VARCHAR(128)[],

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."role_grant" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "principal_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "site_id" UUID,
    "include_descendants" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site"."site" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "parent_site_id" UUID,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "depth" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site"."site_ancestry" (
    "tenant_id" VARCHAR(32) NOT NULL,
    "ancestor_id" UUID NOT NULL,
    "descendant_id" UUID NOT NULL,
    "depth" SMALLINT NOT NULL,

    CONSTRAINT "site_ancestry_pkey" PRIMARY KEY ("tenant_id","ancestor_id","descendant_id")
);

-- CreateIndex
CREATE INDEX "content_item_tenant_site_created_idx" ON "content"."content_item"("tenant_id", "owner_site_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "content_item_tenant_status_idx" ON "content"."content_item"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "content_item_tenant_id_id_key" ON "content"."content_item"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "form_submission_tenant_form_idx" ON "forms"."form_submission"("tenant_id", "form_key", "submitted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "form_submission_tenant_id_id_key" ON "forms"."form_submission"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_account_tenant_id_id_key" ON "identity"."staff_account"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_account_tenant_id_subject_key" ON "identity"."staff_account"("tenant_id", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "staff_account_tenant_id_username_key" ON "identity"."staff_account"("tenant_id", "username");

-- CreateIndex
CREATE INDEX "staff_session_tenant_account_idx" ON "identity"."staff_session"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "staff_session_tenant_idp_session_idx" ON "identity"."staff_session"("tenant_id", "idp_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_session_tenant_id_token_hash_key" ON "identity"."staff_session"("tenant_id", "token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_id_key" ON "identity"."role"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_key_key" ON "identity"."role"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "role_grant_tenant_principal_idx" ON "identity"."role_grant"("tenant_id", "principal_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_grant_tenant_id_id_key" ON "identity"."role_grant"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "site_tenant_id_parent_idx" ON "site"."site"("tenant_id", "parent_site_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_tenant_id_id_key" ON "site"."site"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "site_tenant_id_slug_key" ON "site"."site"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "site_ancestry_tenant_id_descendant_idx" ON "site"."site_ancestry"("tenant_id", "descendant_id", "depth");

-- AddForeignKey
ALTER TABLE "identity"."staff_session" ADD CONSTRAINT "staff_session_account_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "identity"."staff_account"("tenant_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "identity"."role_grant" ADD CONSTRAINT "role_grant_role_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "identity"."role"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "site"."site" ADD CONSTRAINT "site_parent_fkey" FOREIGN KEY ("tenant_id", "parent_site_id") REFERENCES "site"."site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "site"."site_ancestry" ADD CONSTRAINT "site_ancestry_ancestor_fkey" FOREIGN KEY ("tenant_id", "ancestor_id") REFERENCES "site"."site"("tenant_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "site"."site_ancestry" ADD CONSTRAINT "site_ancestry_descendant_fkey" FOREIGN KEY ("tenant_id", "descendant_id") REFERENCES "site"."site"("tenant_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- Hand-written: tenant pattern backstop (the kernel's parseTenantId), as on isolation_probe.
ALTER TABLE "site"."site" ADD CONSTRAINT "site_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');
ALTER TABLE "site"."site_ancestry" ADD CONSTRAINT "site_ancestry_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');
ALTER TABLE "content"."content_item" ADD CONSTRAINT "content_item_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');
ALTER TABLE "forms"."form_submission" ADD CONSTRAINT "form_submission_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');
ALTER TABLE "identity"."staff_account" ADD CONSTRAINT "staff_account_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');
ALTER TABLE "identity"."staff_session" ADD CONSTRAINT "staff_session_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');
ALTER TABLE "identity"."role" ADD CONSTRAINT "role_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');
ALTER TABLE "identity"."role_grant" ADD CONSTRAINT "role_grant_tenant_id_check" CHECK ("tenant_id" ~ '^[a-z][a-z0-9-]{1,31}$');
ALTER TABLE "identity"."staff_session" ADD CONSTRAINT "staff_session_token_hash_check" CHECK (octet_length("token_hash") = 32);
ALTER TABLE "site"."site" ADD CONSTRAINT "site_not_own_parent_check" CHECK ("parent_site_id" IS DISTINCT FROM "id");

-- Grants (the group role exists from the cluster bootstrap).
GRANT USAGE ON SCHEMA "site", "content", "forms", "identity" TO "phoenix_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "site"."site", "site"."site_ancestry", "content"."content_item", "forms"."form_submission",
  "identity"."staff_account", "identity"."staff_session", "identity"."role", "identity"."role_grant"
  TO "phoenix_app";

-- Row-level security: the reference policy of 20261026120100 on every tenant-scoped table.
ALTER TABLE "site"."site" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_tenant_isolation" ON "site"."site" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "site"."site_ancestry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_ancestry_tenant_isolation" ON "site"."site_ancestry" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "content"."content_item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_item_tenant_isolation" ON "content"."content_item" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "forms"."form_submission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "form_submission_tenant_isolation" ON "forms"."form_submission" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "identity"."staff_account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_account_tenant_isolation" ON "identity"."staff_account" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "identity"."staff_session" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_session_tenant_isolation" ON "identity"."staff_session" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "identity"."role" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_tenant_isolation" ON "identity"."role" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
ALTER TABLE "identity"."role_grant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_grant_tenant_isolation" ON "identity"."role_grant" AS PERMISSIVE FOR ALL TO "phoenix_app"
  USING ("tenant_id" = "platform"."current_tenant_id"()) WITH CHECK ("tenant_id" = "platform"."current_tenant_id"());
