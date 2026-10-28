-- Reverses 20261028130000_objects: the policies and grants first, then the tables (the
-- definition's foreign key to its published revision first, so the revisions can go), then
-- the schema.
DROP POLICY "object_record_tenant_isolation" ON "objects"."object_record";
DROP POLICY "object_revision_tenant_isolation" ON "objects"."object_revision";
DROP POLICY "object_definition_tenant_isolation" ON "objects"."object_definition";

REVOKE ALL ON TABLE "objects"."object_record" FROM "phoenix_app";
REVOKE ALL ON TABLE "objects"."object_revision" FROM "phoenix_app";
REVOKE ALL ON TABLE "objects"."object_definition" FROM "phoenix_app";
REVOKE USAGE ON SCHEMA "objects" FROM "phoenix_app";

ALTER TABLE "objects"."object_definition" DROP CONSTRAINT "object_definition_published_revision_fkey";
DROP TABLE "objects"."object_record";
DROP TABLE "objects"."object_revision";
DROP TABLE "objects"."object_definition";
DROP SCHEMA "objects";
