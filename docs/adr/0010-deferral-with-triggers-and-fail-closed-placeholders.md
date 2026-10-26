# ADR-0010: Deferral with Triggers and Fail-Closed Placeholders

**Status:** Accepted — 2026-10-26 (owner decision: Phase 0 review final decision)
**Relates to:** MondaPac ADR-0015 (deferred platform foundations), MondaPac ADR-0031
(fail-closed placeholder bindings), ADR-0001

## Context
`platform/` will hold authz, call-context, tenant-context, clock, ids, unit-of-work,
persistence, events, scheduler, worker, audit, subject-keys, i18n, mail, storage, rate-limit,
http, health, ai and extensions. Building all of it up front delays the first useful slice;
building it late lets modules invent workarounds. Parallel tracks also need to code against
facades that are not merged yet.

## Decision
1. **Deferral with triggers.** No platform piece is built before its first consumer; each lands
   no later than the change that first consumes it. The trigger table below is checked before a
   slice starts and amended (italic note) when a phase review moves a trigger. Phase 0 brings
   only shared-kernel, persistence/UnitOfWork/tenant guard, DB roles, health and logging
   (slice 0.4).

   | Piece | Trigger (first consumer) | Phase |
   |---|---|---|
   | authz, call-context, tenant-context | first use case with an `access` rule | 1 |
   | events, outbox, worker, scheduler | first cross-module reaction or job | 1 |
   | audit, subject-keys | first permission change / first personal-data field | 1 |
   | storage, i18n, mail, rate-limit | first upload / first panel string / first e-mail / sign-in | 1 |
   | extensions | first tenant-specific behaviour | 2 |
   | ai | first approved AI capability | 5 |
2. **Fail-closed placeholders only.** A consumer may merge against an unmerged facade through
   a port it owns, bound to a class marked `@FailClosedPlaceholder('<port>')` under
   `infrastructure/placeholders/` that always answers a refusal the consumer already handles —
   never "yes" or "all". It is constant: it does not read config or environment.
3. **No permissive fakes outside tests;** fakes live under `test/` or `contracts/testing/` and
   `pnpm boundaries` fails on any import from production code.
4. **Not launchable:** the bound placeholder set is derived at start-up and logged; API and
   worker refuse to start unless `NODE_ENV` is explicitly `development` or `test` while it is
   non-empty. Bagher checks the set at every release gate.
5. **One binding PR per dependency** replaces the placeholder with the real facade, reviewed by
   security-tester when the port is on a mandatory path.
6. **Never stubbed:** authentication, permission, ownership and tenant checks.

## Consequences
- Tracks proceed in parallel without opening holes; each placeholder costs one swap PR.
- Staging with `NODE_ENV=production` refuses to start while a placeholder is bound — intended.

## Alternatives considered
- Strict dependency order: serialises tracks.
- Permissive stubs behind feature flags: the flag is the hole; rejected.
