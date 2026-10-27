# ADR-0013: Speed Mode, Phase Review and Module Gates

**Status:** Accepted — 2026-10-26 (owner decisions: phase review before every phase; speed mode
from day one; Claude pushes and opens PRs, only the owner merges (decision 5 amended by ADR-0021); Phase 0 PoCs are
run-and-report only)
**Relates to:** MondaPac ADR-0013 (module readiness gates), MondaPac `docs/process/speed-mode.md`,
`docs/process/speed-mode.md`, `docs/process/parallel-tracks.md`, `docs/phases/phase-0-review.md`

## Context
MondaPac had coded about 25% of its platform by 2026-10-09; most cost went to re-reading long
documents, three reviews per PR, tiny PRs, design documents before code and Figma round trips
(identity alone used about 46%). The owner wants that lesson applied from day one, and wants to
see and decide every phase before it is built.

## Decision
1. **Phase review (owner rule 0).** No phase starts without a joint review package in
   `docs/phases/phase-<n>-review.md` (goal, modules and tiers, slices and order, decisions with
   the team's recommendation, risks, exit criteria). The owner reads a Persian summary; decisions
   are asked one at a time as decision cards; answers are recorded with date; building starts
   only after the owner's final decision on the whole phase. A change of scope or a hard rule
   mid-phase stops the work for a mini-review. Skill: `phoenix-phase-review`.
2. **Module gates (lightweight MondaPac ADR-0013):** tier A — identity/authz, tenancy, process,
   objects, forms — G1 + G2 + security review; tier B — portal, pages, sites, notifications,
   search, media, commerce — one combined gate; tier C — reporting and P2+ features without
   effect on permissions, personal data or processes — product-owner approval. Register:
   `docs/modules/README.md`.
3. **Speed mode** is active from day one with the nine rules of `docs/process/speed-mode.md`,
   until the owner lifts it. It never removes tests, the Definition of Done, the security review
   of sensitive paths, or an independent penetration test before real data.
4. **Parallel tracks:** at most four (`backend`, `process`, `frontend`, `product`), each with its
   own branch and write area; the board is `docs/process/tracks.md` in the repo.
5. **Push model:** Claude pushes its branch and opens the PR; only the owner merges.
   *(Amended by ADR-0021: the thread that owns a PR merges it, coordinated by the coordinator.)*
6. **Phase 0 PoCs** are run-and-report only: results in `docs/reviews/`, code not merged; Phase 1
   code is built from the approved design.

## Consequences
- The owner's attention is batched into phase reviews; outside them, at most one decision card a day.
- Fewer review passes increase reliance on CI; boundary fixtures and contract tests carry weight.

## Alternatives considered
- MondaPac's full process (G1 + G2 for every key module, three reviews per PR): proven too slow.
- No phase review: the owner explicitly rejected building before a joint review.
