-- Reverses 20261027120000_platform_event_path, in reverse order: the policies and grants
-- first, then the tables with their CHECKs and indexes (the partial claim indexes included),
-- then the probe schema. The platform schema and its helper function stay (earlier migrations).
DROP POLICY "receipt_tenant_isolation" ON "probe"."receipt";
DROP POLICY "inbox_tenant_isolation" ON "probe"."inbox";
DROP POLICY "outbox_tenant_isolation" ON "probe"."outbox";
DROP POLICY "event_delivery_tenant_isolation" ON "platform"."event_delivery";

REVOKE SELECT, INSERT ON TABLE "probe"."receipt" FROM "phoenix_app";
REVOKE SELECT, INSERT ON TABLE "probe"."inbox" FROM "phoenix_app";
REVOKE SELECT, INSERT, UPDATE ("published_at") ON TABLE "probe"."outbox" FROM "phoenix_app";
REVOKE USAGE ON SCHEMA "probe" FROM "phoenix_app";
REVOKE SELECT, INSERT, UPDATE ("status", "attempts", "next_attempt_at", "error_code", "delivered_at", "dead_at") ON TABLE "platform"."event_delivery" FROM "phoenix_app";

DROP TABLE "probe"."receipt";
DROP TABLE "probe"."inbox";
DROP TABLE "probe"."outbox";
DROP TABLE "platform"."event_delivery";
DROP SCHEMA "probe";
