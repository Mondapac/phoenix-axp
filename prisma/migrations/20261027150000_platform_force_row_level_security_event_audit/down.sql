-- Reviewed: returns the seven tables to the state of 20261027120000 and 20261027140000 (RLS
-- enabled, owner exempt), in reverse order.
ALTER TABLE "platform"."audit_chain_checkpoint" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_log_seal" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_log" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "probe"."receipt" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "probe"."inbox" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "probe"."outbox" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."event_delivery" NO FORCE ROW LEVEL SECURITY;
