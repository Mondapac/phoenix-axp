# ADR-0021: Merge Model — the Owning Thread Merges, Coordinated by the Coordinator

**Status:** Accepted — 2026-10-27 (owner decision, given in the project chat and confirmed on a
decision card in the Phase 0 thread)
**Amends:** ADR-0013 decision 5
**Relates to:** ADR-0013, `docs/process/parallel-tracks.md`

## Context
ADR-0013 decision 5 let Claude push and open PRs but kept every merge with the owner. With
several Claude threads working in parallel, PRs waited on the owner even when CI and every
required review were done. The owner decided that each thread merges its own PRs, coordinated by
the project's coordinator session.

## Decision
1. The thread (Claude session) that opened or drives a PR merges it.
2. It merges only when all of these hold: CI is green on the PR head; the combined QA + QC review
   is recorded on the PR; the security review is recorded for the mandatory security paths
   (CLAUDE.md); no blocker is open; the PR is mergeable without conflicts.
3. Merge commits only, never squash, so stacked branches stay valid. Never push to `main`
   directly and never force-push a pushed branch.
4. The thread tells the coordinator session as each PR lands; the coordinator orders merges
   across threads when PRs touch the same files.
5. The owner still approves gates, phase reviews and phase closure.

## Consequences
- PRs stop waiting on the owner for routine merges; the owner reads results instead of merging.
- The review record on each PR becomes the evidence QC (Bagher) checks; a missing review blocks
  the merge.

## Alternatives considered
- Owner merges everything (ADR-0013 as written): replaced by the owner.
- Coordinator merges everything: rejected; the owning thread knows its PR and its CI state best.
