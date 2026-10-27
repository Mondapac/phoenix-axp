-- SPIKE: reverses 20261027090000_spike_tenancy_identity.
DROP TABLE IF EXISTS "identity"."role_grant", "identity"."role", "identity"."staff_session",
  "identity"."staff_account", "forms"."form_submission", "content"."content_item",
  "site"."site_ancestry", "site"."site";
DROP SCHEMA IF EXISTS "identity";
DROP SCHEMA IF EXISTS "forms";
DROP SCHEMA IF EXISTS "content";
DROP SCHEMA IF EXISTS "site";
