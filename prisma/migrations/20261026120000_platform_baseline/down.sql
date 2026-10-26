REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "platform"."isolation_probe" FROM "phoenix_app";
REVOKE USAGE ON SCHEMA "platform" FROM "phoenix_app";
DROP TABLE "platform"."isolation_probe";
