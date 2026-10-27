---
name: phoenix-track-session
description: Use at the start and at the end of every working session on Phoenix AXP, and before a session touches a shared file, takes an ADR number, or pushes a branch and opens a PR, so the parallel work tracks (backend, process, frontend, product) stay out of each other's way.
---

# Phoenix AXP track session

Phoenix AXP is built in at most four parallel tracks: one session per track, each with its own
branch and its own worktree or clone. The rules are in `docs/process/parallel-tracks.md`
(CLAUDE.md rule 15).

Sessions cannot see each other. The board `docs/process/tracks.md` (in the repo) is their only
shared memory, so a session that skips it works on stale assumptions. Claude pushes branches and
opens PRs; the thread that owns a PR merges it under the coordinator once CI and the required
reviews pass (ADR-0021). Only the owner approves gates and phases. Everything a session needs from the
owner goes into one ordered queue on the board.

## Start of a session

1. **Know your track.** If the owner did not say, ask. Tracks: `backend`, `process`,
   `frontend`, `product`.
2. **Fetch and read the board.** `git fetch --prune`, then read `docs/process/tracks.md` on
   `origin/main` (`git show origin/main:docs/process/tracks.md`) and on any open board PR.
3. **Check the folder.** You are in your track's worktree or clone as listed on the board. If
   not, do not write or check out there; tell the owner.
4. **Check git.** `git status -sb`, `git log --oneline -5 --all --decorate`, `gh pr list`.
5. **Check the phase.** The work belongs to a phase whose review in
   `docs/phases/phase-<n>-review.md` has the owner's final decision. If not, stop: only the
   `product` track may work on a phase that is not yet approved (to prepare its review).
6. **Reconcile.** If the board and git disagree (a merged PR still listed as waiting, a branch
   the board does not know), fix your own row first and close owner-queue items the owner has
   done.
7. **Tell the owner**, in Persian, in a few lines: track, branch, what this session will do,
   what it is waiting for.

## During the session

- **Stay in your track's write area** (table in `docs/process/parallel-tracks.md`). Reading is
  free everywhere.
- **One feature, one branch, one PR**, cut from the latest `origin/main`.
- **Shared files** (`CLAUDE.md`, `README.md`, playbooks, `.claude/`, `docs/modules/README.md`,
  `docs/modules/_template/`, `docs/process/`, ADR numbering, root tooling and lockfile, CI,
  compose, `.env.example`, migration order, any path no track owns): record the file on the
  board as held by your track before editing, and change it in a small PR of its own. If another
  track holds it, wait for that PR to merge.
- **ADR numbers:** reserve the next free number on the board before writing the ADR.
- **Work that belongs to another track:** write it under "Requests between tracks"; do not do it.
- **Owner decisions:** one at a time as decision cards, recommended option first; at most one
  card a day under speed mode, except on a phase review day.

## End of a session

1. **Hand over the branch** following `phoenix-repo-doc-change`: bring it up to date with
   `origin/main` (merge, do not rewrite pushed history), run `pnpm verify` for code changes,
   push the branch and open the PR. Merge only per ADR-0021 (CI green, reviews recorded, no
   blocker, coordinator informed, merge commit).
2. **Update the board** (once a day under speed mode). The board is a file in the repo, so
   board updates travel in a PR too: read the latest version on `origin/main` (and any open board
   PR) immediately before writing, change only your own row and your own owner-queue items (new
   items carry the date they were opened), raise `revision` by one, and commit it on your branch
   or in a small `docs/board-<track>-<date>` PR. If a board conflict appears at merge, the later
   PR merges the other's rows and takes the next revision.
3. **Report to the owner** in Persian, addressing them as «صاحب پروژه»: what changed, the branch,
   the PR link, the merge order if several PRs wait, and the open items.
