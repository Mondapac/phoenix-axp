-- Reverses 20261030200000_process_drafts: the policy and grants, then the table.
DROP POLICY "process_draft_tenant_isolation" ON "process"."process_draft";
REVOKE ALL ON TABLE "process"."process_draft" FROM "phoenix_app";
DROP TABLE "process"."process_draft";
