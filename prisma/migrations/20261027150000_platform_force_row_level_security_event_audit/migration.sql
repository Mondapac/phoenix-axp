-- Row-level security applies to the table owner too (security review S5-3, as S2-1 did for
-- platform.isolation_probe in 20261026120200). Without FORCE the owner, the migration role
-- phoenix_migrator, is exempt from the policies and sees and writes every tenant's events,
-- deliveries, inbox rows and audit rows. With FORCE it matches no policy (they name
-- "phoenix_app" only) and sees and writes no tenant row. The owner can still lift FORCE or turn
-- the audit triggers off with ALTER TABLE; keeping that credential off runtime hosts and
-- alerting on it are tracked in docs/platform-deferred.md (S5-2).
ALTER TABLE "platform"."event_delivery" FORCE ROW LEVEL SECURITY;
ALTER TABLE "probe"."outbox" FORCE ROW LEVEL SECURITY;
ALTER TABLE "probe"."inbox" FORCE ROW LEVEL SECURITY;
ALTER TABLE "probe"."receipt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_log" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_log_seal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_chain_checkpoint" FORCE ROW LEVEL SECURITY;
