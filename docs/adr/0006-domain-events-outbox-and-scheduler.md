# ADR-0006: Domain Events, Outbox and Scheduler

**Status:** Accepted — 2026-10-26 (owner decision: Phase 0 review final decision)
**Relates to:** MondaPac ADR-0006, ADR-0001, ADR-0002, ADR-0005

## Context
Modules react to each other only through events (ADR-0001), and the Flowable bridge needs
reliable delivery across two databases. MondaPac's outbox, relay, inbox and scheduler are
tested and transferable.

## Decision
1. **Envelope:** `eventId`, `type` as `<module>.<subject>-<past-participle>.v<N>`, `tenantId`,
   aggregate id and version, `correlationId`, `causationId`. **Events carry no actor**;
   handlers run as the system actor.
2. **Payload:** declared with `defineEvent` over a closed field vocabulary — no free strings — so
   personal data cannot enter an event. The event catalogue is snapshot-tested.
3. **Outbox:** one `<module>.outbox` table per module, written in the use case's transaction.
4. **Relay:** in the worker role, `FOR UPDATE SKIP LOCKED`; at-least-once delivery.
   *(Amended by ADR-0020: across an external call the relay holds a lease, not a row lock (PoC 3 R2); a duplicate external start keeps the first and records an orphan incident.)*
5. **Inbox:** one per module, keyed `(event_id, handler)`, makes handlers idempotent.
   *(Amended by ADR-0020: inbox and delivery keys lead with `tenant_id`: `(tenant_id, event_id, handler)`.)*
6. **EventBus port:** an in-process durable adapter today; NATS or Kafka only through a new ADR.
7. **Scheduler:** fixed-interval jobs guarded by `pg_try_advisory_xact_lock`; every job is safe to
   run twice and resolves exactly one tenant per unit of work.

## Consequences
- No broker to operate in the first phases, which matters for on-prem installs.
- Handlers must be idempotent; QA tests redelivery.

## Alternatives considered
- A broker from day one: operational cost for on-prem; deferred behind the port.
- Direct calls between modules for commands: couples modules; rejected.
