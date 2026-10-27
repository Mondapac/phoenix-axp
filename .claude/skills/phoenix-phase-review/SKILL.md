---
name: phoenix-phase-review
description: Use before any Phoenix AXP PLAYBOOK phase starts (and for a mini-review when scope or a hard rule changes mid-phase): prepare the joint phase review package, take the owner through its decisions one at a time, record the answers, and start building only after the owner's final decision.
---

# Phoenix AXP phase review (owner rule 0, ADR-0013)

**Owner decision, 2026-10-26:** no phase starts without a joint review. The phase review
approves the whole phase; module gates (`phoenix-module-gate`) for the tier A modules in it run
inside the approved phase.

## 1. Prepare the package (Hadi, with Ali and Javad; `product` track)
1. Reserve the file on the board: `docs/phases/phase-<n>-review.md` (Persian).
2. Read `PLAYBOOK-fa.md` (the phase row), `docs/features/00-INDEX.md`, `docs/modules/README.md`,
   the ADR index, the previous phase's review and its `docs/reviews/` results.
3. Write the package with these sections:
   1. هدف فاز — goal and output of the phase
   2. خروجی‌ها و برش‌ها — slices table: `#`, slice, track, roles, content; then the order and
      the active tracks (at most four)
   3. ماژول‌ها و سطح — modules with tier A/B/C
   4. تصمیم‌های لازم — table `D1..Dn`: question | team recommendation | owner answer (empty)
   5. ریسک‌ها — risk | impact | mitigation
   6. معیار خروج — exit criteria, each checkable by Bagher
   7. تصمیم نهایی صاحب پروژه — table: date | decision (empty)
4. Run `phoenix-role-review` on the draft (Hadi, Mohammad, Ali; add Hassan, Mojtaba, Reza,
   Kazem by topic; Javad for pace and process). Merge the changes.
5. Commit and open a PR following `phoenix-repo-doc-change` (`docs(phase-<n>): …`).

## 2. Review with the owner
1. Send a short **Persian summary** in the thread: goal, slices, modules, top risks, and how
   many decisions are needed.
2. Ask the decisions **one at a time as decision cards** (AskUserQuestion or the host's
   decision-card tool): the question, 2-4 options with a one-line consequence each, the team's
   recommendation marked. Wait for each answer before the next card. On the phase review day the
   one-card-a-day limit does not apply.
3. If an answer needs a proposal the package lacks, run a short role review first.

## 3. Record
1. Write each answer with its date in the decisions table (bold the answer).
2. A decision that reaches beyond one module becomes an ADR (reserve the number on the board).
   A decision that changes a hard rule updates `CLAUDE.md` in the same PR.
3. Ask the owner for the **final decision** on the whole phase as the last card; record it in
   section 7 with the date.
4. Update the board: phase status, owner queue, reserved numbers.

## 4. Build only after the final decision
- Tracks other than `product` start the phase's slices only after section 7 holds an approval.
- If, during the phase, something changes scope or a hard rule: stop that work, write a short
  mini-review (same sections, only the change) as a dated addendum in the same file, ask the
  owner, record, then continue.
- At phase close, Bagher checks every exit criterion with evidence, Javad writes the phase
  assessment, and the owner approves the close; then the next phase's package is due.
