# ADR-0024: Field-Level Access and Per-Definition Operation Permissions

**Status:** Proposed — 2026-10-27, for decision by `software-architect` and `cto` (the owner
delegated the design on 2026-10-27; the requirement itself is owner decision D8 of the Phase 2
review)
**Amends (if accepted):** ADR-0004 decision 6 (permission keys)
**Relates to:** ADR-0004, ADR-0007, ADR-0017 (Objects), ADR-0018 (site scope),
`docs/phases/phase-2-review.md` (D6, D8, slice 2.0)

## Context
The owner requires (D8, 2026-10-27) that access be definable down to the field: for a role, which
fields of a form, a task form or an Object can be seen or edited; and that every module and every
Object carry its own access for its own operations and fields.

Today (ADR-0004, `platform/authz`) a permission is a static key `<module>.<resource>.<action>`
registered at start-up, scoped by tenant and site (ADR-0018). Forms and Objects are definitions
that tenant staff create at run time, so their operations and fields are not known at start-up.
Objects expose REST and GraphQL (D6), so a field must stay hidden on every read path: pages,
REST, GraphQL (including nested fields), exports, search results and task forms.

## Options

### Option A — field policy as role data, evaluated in `platform/authz` (recommended)
1. **Operations of definitions keep static keys with a definition qualifier.** A grant of
   `objects.record.read|create|update|delete` (and `forms.submission.read|update|export`) names
   the definition it applies to (one Object or form definition, or all), the same way a grant
   already names a site and `thisSite | includeDescendants`. The key registry stays static, so
   "unknown keys grant nothing" and the CI "no silent use case" check stay as they are.
2. **Field rules belong to the role.** For a role and a definition: per field `hidden`,
   `read` or `edit`. Stored with the role (identity, versioned V1, every change audited), keyed by
   the field's stable id, not its label, so renaming a field keeps the rule.
3. **Default for a field without a rule (open question D9, delegated with this ADR):** the field
   follows the operation permission (read grants `read`, update grants `edit`), except fields the
   definition marks `sensitive` (for example a national id), which are `hidden` until a rule opens
   them. A field can never be wider than the operation: `edit` without the update permission is
   `read`.
4. **One evaluator.** `FieldPolicy` in `platform/authz` resolves, from the `ActorContext` only,
   the field mode map for (actor, definition revision). Use cases apply it at their boundary:
   reads project the result (hidden fields are removed, not nulled), writes refuse any change to a
   field that is not `edit` (`403 access.field-denied`, naming no hidden field). Generated REST and
   GraphQL resolvers, exports, search indexing projections and task-form rendering call the same
   evaluator; no read path builds its own projection.
5. **Process steps narrow further.** A user task can make fields read-only or hidden for that step
   (modeller setting); the effective mode is the narrower of role and step.
6. **Static modules** (tenancy, identity, later modules) opt in by declaring field ids for a
   resource in `contracts/`; until a module declares them, its resources have operation-level
   access only.

### Option B — one permission key per field
`objects.<object>.field.<field>.read|edit` registered per tenant at run time. Rejected: the
registry becomes dynamic and per tenant, keys multiply with every field, renaming a field breaks
grants, and the unknown-key and CI checks lose their meaning.

### Option C — hide fields in the UI only
Rejected: REST, GraphQL and exports would leak; it fails ADR-0004 (authorisation in the
application layer).

## Consequences (Option A)
- Slice 2.0 builds `FieldPolicy` and the grant qualifier before 2.5 and 2.8 consume them; slice
  1.6 (roles and grants) must leave room for the definition qualifier and field rules.
- Every read path needs a test that a hidden field is absent, on two tenant fixtures; GraphQL
  needs it for nested selections.
- Cost: one field-mode map per (actor, definition revision) per request, computed inside the
  request's "actor snapshot" unit (ADR-0020); no cache across requests (ADR-0004).
- Personal data rules are unchanged: a field that is `read` for a role is still encrypted at rest
  (`SubjectKeyService`).
- Mandatory security review (authorisation path).

## Decision
Pending: `software-architect` and `cto`.
