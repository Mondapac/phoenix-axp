-- Reverses 20261027200000_forms: the policies and grants first, then the two tables (the
-- form's foreign key to its published revision first, so the revisions can go), then the
-- schema.
DROP POLICY "form_revision_tenant_isolation" ON "forms"."form_revision";
DROP POLICY "form_tenant_isolation" ON "forms"."form";

REVOKE ALL ON TABLE "forms"."form_revision" FROM "phoenix_app";
REVOKE ALL ON TABLE "forms"."form" FROM "phoenix_app";
REVOKE USAGE ON SCHEMA "forms" FROM "phoenix_app";

ALTER TABLE "forms"."form" DROP CONSTRAINT "form_published_revision_fkey";
DROP TABLE "forms"."form_revision";
DROP TABLE "forms"."form";
DROP SCHEMA "forms";
