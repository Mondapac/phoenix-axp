# ADR-0005: BPMN — Flowable OSS as a Separate Service

**Status:** Accepted — 2026-10-26 (owner decision: full BPMN, Flowable OSS as a separate service)
**Relates to:** ADR-0006 (outbox and inbox), ADR-0007 (form revisions), ADR-0004, ADR-0009

## Context
The pilot needs full BPMN (user tasks, timers, escalation, DMN). The team writes TypeScript; no
mature permissively licensed BPMN engine exists in that ecosystem. Flowable OSS (Apache-2.0) is
mature and ships a REST image.

## Decision
1. **Runtime:** Flowable OSS as a separate service from the `flowable/flowable-rest` image,
   reachable only from the core's network, with its own credentials.
   *(Amended by ADR-0020: on-prem and offline builds ship the image or war with the PostgreSQL JDBC driver and timer settings.)*
2. **One module talks to it:** `process`, through a port in `application/ports` and an adapter in
   `infrastructure/`. No other module imports the adapter or calls Flowable.
   *(Amended by ADR-0020: the adapter passes the tenant on every call and re-checks the tenant, id and business key of every returned object.)*
3. **Two databases, coordinated by outbox and inbox:** core → Flowable: an outbox event relayed to
   Flowable REST with an idempotency key; Flowable → core: event listener or polling, received in
   `process.inbox` keyed `(event_id, handler)`.
   *(Amended by ADR-0020: the key is `(tenant_id, event_id, handler)`.)*
4. **Responsibilities:** Flowable executes processes, timers and DMN. The core owns the task
   inbox, forms, authorisation, audit and personal data. A task is completed only through a core
   use case that authorises the user; nobody completes tasks in Flowable directly.
5. **Forms:** each user task points to one immutable form revision (ADR-0007).
6. **Modeller:** bpmn-js in the studio panel, with the bpmn.io watermark visible per its licence.
7. **Process variables** carry ids and the minimum needed for routing, not personal data.

## Consequences
- A dual-write risk (lost or duplicated task) — PoC 3 must show none, with timers and escalation.
- Flowable is Java: one more runtime to package for on-prem and the offline installer.
- security-tester review is mandatory on the bridge.

## Alternatives considered
- Camunda 8: licence not permissive for production; rejected.
- A home-grown TypeScript engine: full BPMN is too large; rejected.
- Embedding Flowable's database in the core schema: couples upgrades and ownership; rejected.
