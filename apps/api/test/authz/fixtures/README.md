# Use-case discovery fixtures

Ported from Mondapac `apps/api/test/authz/fixtures/`, without the seller-state cases (Phoenix
has no seller) and, until slice 1.2 brings the job registry, without the job cases.

Source trees for `test/authz/use-cases.spec.ts`, the discovery and CI check of Phoenix
ADR-0004 decision 4 (ported from Mondapac identity design 5.2). Each tree stands in for `apps/api/src/` and holds a `modules/` folder.

- `valid/` passes every check: one use case of each rule kind, keys declared in
  `contracts/`, and its own checked-in list (`access-declarations.json`).
- `broken/` holds one file per refused case; the spec asserts the exact list of problems.

The fixtures are type-checked with the API (no `@ts-expect-error`); a declaration that the
types would refuse is cast, because the check must refuse it at run time too. Nothing here is
loaded by the application.
