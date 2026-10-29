-- Reverses 20261028120000_identity_portal_sign_in: the policies and grants, the tables, then
-- the account's checks and its username back to NOT NULL (refused while a portal account
-- exists, which has none).
DROP POLICY "portal_code_tenant_isolation" ON "identity"."portal_code";
DROP POLICY "portal_contact_tenant_isolation" ON "identity"."portal_contact";
DROP POLICY "portal_sign_in_settings_tenant_isolation" ON "identity"."portal_sign_in_settings";
REVOKE ALL ON TABLE "identity"."portal_code" FROM "phoenix_app";
REVOKE ALL ON TABLE "identity"."portal_contact" FROM "phoenix_app";
REVOKE ALL ON TABLE "identity"."portal_sign_in_settings" FROM "phoenix_app";
DROP TABLE "identity"."portal_code";
DROP TABLE "identity"."portal_contact";
DROP TABLE "identity"."portal_sign_in_settings";
ALTER TABLE "identity"."account"
  DROP CONSTRAINT "account_portal_subject_check",
  DROP CONSTRAINT "account_directory_subject_check",
  DROP CONSTRAINT "account_population_username_check",
  DROP CONSTRAINT "account_population_source_check",
  DROP CONSTRAINT "account_source_check",
  ADD CONSTRAINT "account_source_check" CHECK ("source" IN ('directory', 'local')),
  ADD CONSTRAINT "account_directory_subject_check" CHECK ("source" = 'local' OR "subject" IS NOT NULL);
ALTER TABLE "identity"."account" ALTER COLUMN "username" SET NOT NULL;
