# ADR-0012: Object Storage on SeaweedFS and PostgreSQL-First Search

**Status:** Accepted — 2026-10-26 (owner decision: SeaweedFS; PostgreSQL full-text search first,
confirmed in the Phase 0 review)
**Relates to:** MondaPac ADR-0016 and ADR-0029 (MinIO removal, object storage and file intake),
ADR-0009, ADR-0010

## Context
Portals and forms take file uploads; sites need media. MondaPac dropped MinIO for its licence
(AGPL) and the end of its community edition. Search is needed early but its scale is unknown;
another stateful service is a cost for on-prem installs.

## Decision
1. **`ObjectStore` port** in `platform/storage`; adapter for the S3 API of **SeaweedFS**
   (Apache-2.0) in compose and on-prem. Any S3-compatible store can be plugged in by adapter.
2. **Keys are tenant-scoped** (`<tenant>/<module>/<id>`); access through short-lived signed URLs
   issued by a use case that checked permission and ownership.
3. **File intake:** size and type limits, content sniffing, a malware-scan hook, metadata in the
   owning module's schema; files with personal data follow the subject-key rules (ADR-0007).
4. **Search:** PostgreSQL full-text search first, with Persian normalisation (ADR-0008), behind a
   `Search` port.
5. **OpenSearch triggers** (deferral, ADR-0010): a separate ADR when volume, advanced Persian
   linguistics, or cross-site search exceed what PostgreSQL serves within the agreed latency.

## Consequences
- One less service in early phases; search quality for Persian is limited until the trigger.
- File intake is a mandatory security-review path.

## Alternatives considered
- MinIO: AGPL; rejected (ADR-0009).
- OpenSearch from day one: operational cost before need.
