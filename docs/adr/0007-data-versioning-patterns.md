# ADR-0007: Data Versioning Patterns V1-V4 and Personal Data

**Status:** Accepted — 2026-10-26 (owner decision: Phase 0 review final decision, slice 0.2).
The form renderer choice stays open for the Phase 2 review.
**Relates to:** MondaPac ADR-0009, ADR-0003, ADR-0005, ADR-0006, ADR-0015

## Context
Government processes must show exactly which form and process a citizen used, years later.
Definitions (forms, Objects, pages) change often; submissions and history must not.

## Decision
1. **Every entity declares one pattern** in its design doc and schema comment:
   - **V1 — immutable revisions** with `published_revision_id`: form definitions, Object
     definitions, content, pages. A published revision is never edited.
   - **V2 — effective-dated** (`valid_from`, `valid_to`, non-overlapping): SLA settings,
     working calendars.
   - **V3 — snapshot at reference:** a form submission stores the form revision id, the process
     definition revision and a content hash.
   - **V4 — append-only history:** request status history, audit.
2. **Forms:** JSON Schema + UI Schema. Renderer: JSON Forms (MIT) or RJSF (Apache-2.0), decided
   in the Phase 2 review.
3. **Personal data** is encrypted under a per-subject key (`SubjectKeyService`); erasure destroys
   the key (crypto-shredding). Personal data never appears in events, logs or audit values.

## Consequences
- Storage grows with revisions; acceptable for the audit value.
- Queries on "current" data go through the published revision pointer.
- Every design names its pattern; database-designer backs it with constraints.

## Alternatives considered
- Mutable definitions with an audit trail: cannot reproduce what a user saw.
- Event sourcing everywhere: cost without need.
