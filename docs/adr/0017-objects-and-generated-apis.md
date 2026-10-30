# ADR-0017: Objects and Generated APIs

**Status:** Accepted — 2026-10-28, by `software-architect` and `cto` (slice 2.8; the owner
delegated technical design on 2026-10-27; the requirements are owner decisions D6 and D8 of the
Phase 2 review)
**Relates to:** ADR-0001, ADR-0002, ADR-0004, ADR-0007, ADR-0008, ADR-0018, ADR-0024,
`docs/phases/phase-2-review.md` (D6, D8, slices 2.8 and 2.11)

## Context
Objects is low-code data modelling in the style of Liferay Objects: tenant staff define a
record type (an Object) and its fields at run time, then staff read and write its records through
an API generated from the definition. The Phase 2 review requires that every generated operation
is a use case with an `access` rule (CI "no silence"), that records carry record-level access
from the `ActorContext`, that field-level access (ADR-0024) holds on every read path, and that
both REST and GraphQL are served in Phase 2 (D6). The studio screens are slice 2.11.

## Decision
1. **Module `objects`, schema `objects`.** It owns definitions, revisions and records; it reads
   sites through `SiteAncestryReader` and grants through `FieldRuleReader` /
   `ActorGrantReader` (platform/authz ports), never another module's tables.
2. **Definition (V1).** `object_definition`: owning site, key (slug, unique in the tenant; the
   API path segment), name, status `draft | published | retired`, the published revision and a
   revision counter, with an optimistic `version`. `object_revision` is inserted once and never
   changed (INSERT + SELECT grants only) and holds the field list and its `sha256:` content hash.
   Draft, publish and retire follow the forms lifecycle; designing and publishing are separate
   keys (D7). A record is written only under the published revision.
3. **Fields.** Each field has a stable UUIDv7 id (minted when it first appears, kept across
   revisions and renames; ADR-0024 keys rules on it), an API key (slug, unique in the
   revision), a label, a type, `required`, `sensitive` and an optional portal mode. Types in
   slice 2.8: `text`, `long-text`, `integer`, `decimal`, `boolean`, `date` (ISO calendar date;
   panels show it in the tenant's calendar, ADR-0008), `date-time` (an instant) and `choice`
   (one of the field's closed option keys). A field is `sensitive` unless the designer says
   otherwise when it first appears; lowering it later needs the protected key
   `objects.definitions.lower-sensitivity`. References between Objects come later with their
   own slice (ADR-0024 decision 6 already fixes their read rule).
4. **Record (V3).** `object_record` keeps the revision it was last written under and that
   revision's hash, its owning site, the account that created it, and the values keyed by field
   id: non-sensitive values in `values` (jsonb); sensitive values sealed under the record's own
   subject key (`SubjectKeyService`, subject = the record id). Deleting a record destroys its key
   and removes the row; the audit keeps ids only. An update writes under the current published
   revision: values of fields that revision no longer has are dropped. An update names the
   version it read and must name at least one field. Each record also keeps the revision whose
   `sensitive` marks split its values (`sealed_under_id`). When a published revision marks a
   field sensitive, the `objects.seal-records` job (every 15 minutes, per tenant) seals that
   field's existing plain values under each record's key, in the records split under any other
   revision (an earlier one, or a later one after a rollback), without changing the values, the version or the revision written under. Until it
   runs, reads already hide the field. The job only seals: it never opens a sealed value to
   plain. A field whose sensitivity was lowered moves to plain only when a writer rewrites the
   record.
   Publishing a revision that leaves plain a field the served revision marks sensitive (a
   rollback) is a lowering: it needs `objects.definitions.lower-sensitivity` and is audited.
5. **Record-level access.** A record is owned by one site: the definition's site or a site
   below it, chosen at creation and checked against the creator's grants (never trusted from
   input alone). Check order (ADR-0024 decision 2): tenant, then the record's site against the
   grants conferring the operation key (ADR-0018 subtree), then the definition qualifier, then
   field modes. A record the actor's grants do not reach answers "not found". A definition the
   actor's grants for the operation reach nowhere answers exactly as an unknown key. Lists
   filter in the query by the sites the actor's read grants cover, so pages are never short.
   A required field is checked on update only when the writer may edit it, so no refusal tells
   whether a field the writer cannot edit is empty. A required field the writer may edit but not
   read is still named when empty; this is accepted, since the writer may overwrite it.
6. **Permissions.** `objects.definitions.view | design | publish` (site scope),
   `objects.definitions.lower-sensitivity` (tenant, protected), and
   `objects.record.read | create | update | delete` (site scope, definition qualifier).
7. **Generated REST.** The API is generated by data, not by code: fixed use cases serve every
   definition, addressed by its key (`/objects/o/<key>/records[/<id>]`). Payloads and answers
   name fields by API key; storage and rules use field ids. `FieldPolicy` is the only
   projection (ADR-0024 decision 11): a read leaves hidden fields out; a write naming any field
   that is not `edit` is refused with `403 access.field-denied`.
8. **Generated GraphQL (D6)** is the next part of slice 2.8, in its own PR after the library PR
   (licence stated, ADR-0009). Its resolvers call the same record use cases, so the gate, record
   access and `FieldPolicy` hold unchanged; generated fields are nullable and a hidden field
   resolves to `null` (ADR-0024 decision 6); depth and complexity are limited and introspection
   is off in production.
   *Clarified 2026-10-30 (generated GraphQL PR):* the library is `graphql` (graphql-js, MIT) behind
   `platform/graphql` (≤ 2 000 tokens, depth ≤ 6, ≤ 200 selected fields, ≤ 3 root fields in a
   query and 1 in a mutation, no subscriptions, no batched bodies, the document sized before
   the schema is built; unexpected errors masked as `internal`). Each Object is served at
   `POST /objects/o/<key>/graphql[?site=<id>]`; its schema is built per request from
   DescribeObject at that site (the definition's site by default), so it names only fields the
   caller may read, create or update there, and a caller DescribeObject refuses gets REST's 401
   or 404. Queries `record(id)` and `records(site, before, limit)`; mutations `createRecord`,
   `updateRecord` (only when a field is writable) and `deleteRecord`; a write answers
   `{ id, version }`. Field names map `-` to `_` (and a leading digit gets `_`); integers use the
   `Long` scalar. Use-case failures come back as errors with their code in `extensions.code`, a
   stale write as `conflict.stale`.
9. **Portal users** read and write records only through `own-resources` use cases with
   `FieldPolicy.forPortal`, in a later slice; slice 2.8 serves staff only.
10. **Events.** `objects.record-*.v1` events land with their first consumer (ADR-0010).

## Consequences
- Every record path needs a test that a hidden field is absent and a non-`edit` field cannot be
  written, on two tenant fixtures; GraphQL repeats it for its resolvers.
- No per-definition tables or columns: a definition change needs no migration. Filtering and
  sorting on field values, and search, come with ADR-0012's search projection.
- Mandatory security review (authorisation, personal data); database-designer signs off the
  schema.

## Alternatives
- **A table per Object (DDL at run time):** rejected; run-time DDL needs the migrator role in the
  application, breaks the reviewed-migration rule (ADR-0003) and RLS per table.
- **Code generation per definition:** rejected; generated code cannot be reviewed per tenant and
  would need a deploy per change.
- **Records owned by the definition's site only:** rejected; a ministry defines an Object once
  at its root site and its provinces keep their own records below it (ADR-0018).
