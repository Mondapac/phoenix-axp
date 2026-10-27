---
name: phoenix-repo-doc-change
description: Use when changing any file in the Phoenix AXP repo (ADRs, feature docs, module briefs, phase reviews, CLAUDE.md, agents, skills, playbooks), so edits, branches, commits, pushes and PRs follow the project's conventions.
---

# Phoenix AXP repo doc change

Work runs in parallel tracks, each on its own branch and write area
(`docs/process/parallel-tracks.md`, CLAUDE.md rule 15). Other sessions work at the same time.

## Before editing
1. Read the board `docs/process/tracks.md` on the latest `origin/main`: which track holds which
   branch, which shared files are held, which ADR numbers are reserved.
2. Run `git fetch --prune`, `git status -sb` and `git log --oneline -5 --all --decorate`.
   Note the current branch and any branch another track is using.
3. Work only in your own track's worktree or clone. Never check out or write in another track's
   folder.
   - Cut the branch from the latest `origin/main` (`docs/<topic>`, `chore/<topic>`,
     `feat/<topic>`, `fix/<topic>`). Stack on unmerged work only when it depends on it; say so
     in the PR.
4. Read the parts of the files you will change (grep and read by section under speed mode).
   - Reserve the next free ADR number on the board before writing an ADR.
   - Before changing a shared file (list in `docs/process/parallel-tracks.md`), record it on
     the board as held by your track and keep the change in a small PR of its own.

## Editing rules
- **Line endings:** LF. Preserve the existing line endings of a file you edit; never re-type a
  file from tool output.
- **Language:** code, ADRs, commit messages, agents and skills in English. Playbooks, module
  briefs, feature docs, phase reviews and owner-facing docs in Persian. IDs and technical terms
  stay in English.
- **ADRs:** MondaPac format (`# ADR-NNNN: <title>`, `**Status:**`, `**Amends:**`,
  `**Relates to:**`, Context, Decision numbered, Consequences, Alternatives considered; about
  one page). Never silently contradict an accepted ADR: write an amending ADR and add an
  italic *(Amended by ADR-XXXX: …)* note to the old one. Update `docs/adr/README.md`.
- **Hard rules:** when a decision changes a hard rule, update `CLAUDE.md` in the same change.
- **Owner decisions:** record the date and "owner decision" in the ADR status or the phase
  review.

## Committing
- **Identity:** if git has no identity configured, commit with
  `git -c user.name="Phoenix AXP" -c user.email="noreply@anthropic.com" commit`.
- **Message:** Conventional Commits (`docs(adr):`, `docs(<module>):`, `docs(process):`,
  `docs(phase-<n>):`, `chore(team):`, …); a body that says what changed and why; end with the
  session's attribution lines.
- Check `git status --short` before committing; never commit secrets, scratch files or outputs.

## Pushing and PRs (owner decisions 2026-10-26 and 2026-10-27)
- Claude pushes its own branch (`git push -u origin <branch>`) and opens the PR (`gh pr create`)
  with a short English description, the related ADRs and phase, and the review status.
- Merge per ADR-0021: the thread that owns the PR merges it, coordinated by the coordinator,
  once CI is green on the head, the required reviews are recorded, the PR merges without
  conflicts and no blocker is open; merge commits only; tell the coordinator once it is in. Never push to
  `main` directly, never force-push a pushed branch (merge `main` into it instead).
- Phase 0 PoC branches are not opened for merge: results go to `docs/reviews/` in a docs PR.

## After pushing
- Update your row on the board `docs/process/tracks.md` (once a day under speed mode) following
  `phoenix-track-session`.
- Reply to the owner in Persian and call them «صاحب پروژه»: what changed, the branch, the PR
  link, the merge order if several PRs wait, and the open items.
