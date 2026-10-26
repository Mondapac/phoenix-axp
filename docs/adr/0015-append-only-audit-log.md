# ADR-0015: Append-Only Audit Log with Hash Chain

**Status:** Accepted — 2026-10-26 (owner decision: Phase 0 review final decision)
**Relates to:** MondaPac ADR-0032 (audit chain hardening), ADR-0003, ADR-0004, ADR-0007

## Context
For government customers an immutable audit trail is a sales requirement: who changed what, in
which tenant, and proof that the log was not altered.

## Decision
1. **Table** `platform.audit_log`, append-only, enforced by a trigger; the app role has only
   INSERT and SELECT.
2. **Writer** runs inside the use case's transaction and accepts only actions from each module's
   closed audit catalogue; values never contain personal data (ids and subject-key references only).
3. **Every row** carries `tenant_id`, actor, action, target, correlation id and the instant from
   `Clock`.
4. **Sealer** in the worker seals rows into a hash chain per tenant; `audit-verify` checks the
   chain and is runnable by an operator on-prem.
5. **Always audited:** permission and role changes, sign-in and session events, tenant and site
   configuration, process task decisions, form publication.

## Consequences
- Audit volume grows fast; partitioning and retention are designed by database-designer.
- A broken chain is an incident, not a warning.

## Alternatives considered
- Application logs as audit: mutable and mixed with personal data; rejected.
