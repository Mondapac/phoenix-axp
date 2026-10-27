-- Reverses 20261027230000_platform_personal_data_and_limits: the policies and grants first,
-- then the trigger, then the three tables.
DROP POLICY "captcha_spent_tenant_isolation" ON "platform"."captcha_spent";
DROP POLICY "rate_limit_window_tenant_isolation" ON "platform"."rate_limit_window";
DROP POLICY "subject_key_tenant_isolation" ON "platform"."subject_key";

REVOKE ALL ON TABLE "platform"."captcha_spent" FROM "phoenix_app";
REVOKE ALL ON TABLE "platform"."rate_limit_window" FROM "phoenix_app";
REVOKE ALL ON TABLE "platform"."subject_key" FROM "phoenix_app";

DROP TRIGGER "subject_key_stays_destroyed" ON "platform"."subject_key";
DROP FUNCTION "platform"."subject_key_reject_revival"();

DROP TABLE "platform"."captcha_spent";
DROP TABLE "platform"."rate_limit_window";
DROP TABLE "platform"."subject_key";
