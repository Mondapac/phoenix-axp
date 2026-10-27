-- Reverses 20261027230100_forms_submissions: the policy and grants first, then the table, then
-- the revisions' field list.
DROP POLICY "form_submission_tenant_isolation" ON "forms"."form_submission";

REVOKE ALL ON TABLE "forms"."form_submission" FROM "phoenix_app";

DROP TABLE "forms"."form_submission";

ALTER TABLE "forms"."form_revision" DROP CONSTRAINT "form_revision_fields_check";
ALTER TABLE "forms"."form_revision" DROP COLUMN "fields";
