# Speed mode

**Status:** Accepted — 2026-10-26 (owner decision: active from day one, until the owner lifts it;
`docs/phases/phase-0-review.md`, ADR-0013).
**Source:** MondaPac `docs/process/speed-mode.md` (accepted there 2026-10-09).

## Context
By 2026-10-09 MondaPac had coded about 25% of its platform. Most model usage went to re-reading
long documents and long session contexts, three role reviews per PR, small PRs, design documents
written ahead of code, and bookkeeping; the identity track alone used about 46%. The
single-open-migration rule, Figma round trips and owner approvals added waiting time. Phoenix AXP
starts with the remedy instead of arriving at it.

## Decision
1. **Model:** coding runs on the cheaper model. The stronger model is used only for the security
   review of sensitive paths.
2. **Sessions:** one fresh session per work package, with a handoff of 5 KB max. No session lives
   longer than a day.
3. **CI is the main gate:** `pnpm verify`, boundaries and the permission contract tests. One
   combined QA + QC review per batch of PRs. The security review stays mandatory, but only on the
   paths listed in `CLAUDE.md` (Team). database-designer sign-off for schema changes is part of
   the combined review.
4. **PR size:** one complete feature per PR (schema + use case + API + tests).
5. **Documents:** no separate or long design documents except the brief and gates of tier A
   modules. Existing documents are read by section (grep), not whole.
6. **Bookkeeping:** the board and status docs are updated once a day, not after each PR.
7. **Migrations:** no single-open-migration-PR rule. Each PR rebases (or merges `main`) right
   before merge and regenerates its migration if needed. A merged migration is never edited.
8. **Design:** Figma-first is paused. UI is built from existing tokens and components; a new
   component goes in code first.
9. **Parallelism and decisions:** at most four parallel build tracks, and at most one decision
   card per day for the owner — except on a phase review day, when all of the phase's decisions
   are asked.

## What speed never removes
Tests, the Definition of Done, the security review of sensitive paths, the phase review before
building, and an independent penetration test before real data.

## Consequences
- Fewer review passes means more reliance on tests and CI; boundary fixtures must prove every rule.
- Figma falls behind the code and is back-ported later.
- The owner can lift speed mode at any time; the overridden rules then apply again.
