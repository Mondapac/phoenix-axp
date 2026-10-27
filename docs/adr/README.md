# Architecture Decision Records

Format (MondaPac): `# ADR-NNNN: <title>`, `**Status:**`, optional `**Amends:**` /
`**Relates to:**`, then Context, Decision (numbered), Consequences, Alternatives considered;
about one page. An accepted ADR changes only through a new ADR or an italic
*(Amended by ADR-XXXX: …)* note. Reserve the next number on the board
(`docs/process/tracks.md`) before writing.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-repository-structure-and-module-contract.md) | Repository structure and module contract | Accepted 2026-10-26 |
| [0002](0002-tenant-as-first-class-dimension-and-isolation.md) | Tenant as the first-class dimension and three-layer isolation | Accepted 2026-10-26 |
| [0003](0003-persistence-prisma-multischema.md) | Persistence: PostgreSQL 17 and Prisma 7 schema-per-module | Accepted 2026-10-26 |
| [0004](0004-hybrid-identity-and-authorisation.md) | Hybrid identity: Keycloak authentication, core sessions and authorisation | Accepted 2026-10-26 |
| [0005](0005-flowable-bpmn-engine-as-separate-service.md) | BPMN: Flowable OSS as a separate service | Accepted 2026-10-26 |
| [0006](0006-domain-events-outbox-and-scheduler.md) | Domain events, outbox and scheduler | Accepted 2026-10-26 |
| [0007](0007-data-versioning-patterns.md) | Data versioning patterns V1-V4 and personal data | Accepted 2026-10-26 |
| [0008](0008-time-calendar-and-locale.md) | Time, calendars, locale and RTL | Accepted 2026-10-26 |
| [0009](0009-licence-policy-and-proprietary-product.md) | Licence policy and proprietary product | Accepted 2026-10-26 |
| [0010](0010-deferral-with-triggers-and-fail-closed-placeholders.md) | Deferral with triggers and fail-closed placeholders | Accepted 2026-10-26 |
| [0011](0011-ai-as-a-cross-cutting-capability.md) | AI as a cross-cutting, agentic capability | Accepted 2026-10-26 |
| [0012](0012-object-storage-and-search.md) | Object storage on SeaweedFS and PostgreSQL-first search | Accepted 2026-10-26 |
| [0013](0013-speed-mode-phase-review-and-module-gates.md) | Speed mode, phase review and module gates | Accepted 2026-10-26 |
| [0014](0014-runtime-and-toolchain-baseline.md) | Runtime and toolchain baseline | Accepted 2026-10-26 |
| [0015](0015-append-only-audit-log.md) | Append-only audit log with hash chain | Accepted 2026-10-26 |
| [0016](0016-panel-ui-base-in-house-components-on-base-ui.md) | Panel UI base: in-house components on Base UI, Metronic as visual reference only | Accepted 2026-10-27 |
| [0018](0018-site-tree-content-sharing-and-subtree-roles.md) | Site tree, content sharing and subtree role scope | Accepted 2026-10-26 |
| [0019](0019-operators-are-staff-with-roles.md) | Operators are staff with roles, one account per employee | Accepted 2026-10-27 |
| [0020](0020-phase-0-poc-outcomes-and-review-amendments.md) | Phase 0 proof-of-concept outcomes and review amendments (amends 0002, 0004, 0005, 0006, 0010) | Accepted 2026-10-27 |
| [0021](0021-merge-model-owning-thread-merges.md) | Merge model: the owning thread merges, coordinated by the coordinator | Accepted 2026-10-27 |
| [0022](0022-phase-1-follow-up-decisions-p5-p7.md) | Phase 1 follow-up decisions: isolation overhead per request, AD sync interval, OFL for fonts (amends 0002, 0009) | Accepted 2026-10-27 |

Reserved (see the board): page builder (Phase 3 review, number to be reserved), 0017 Objects and generated APIs (Phase 2 review).
