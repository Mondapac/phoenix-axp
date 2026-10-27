---
name: phoenix-module-gate
description: Use when a Phoenix AXP module needs to pass its readiness gates (ADR-0013): drafting the module brief, running G1 with the owner, G2 design review, and recording approvals.
---

# Phoenix AXP module readiness gate (ADR-0013)

A module gate sits inside an approved phase (`phoenix-phase-review`): the phase review approves
the phase, the gates approve each module in it. No design starts without an approved G1. No
code is written without an approved G2. Tier B modules pass one combined gate; tier C modules
need product-owner approval only. Tiers and the register are in `docs/modules/README.md`.

Under speed mode only tier A modules get a full brief and both gates; keep briefs short and
read existing docs by section.

## 1. Prepare
- Read:
  - `docs/modules/README.md` for the module's tier and phase
  - `docs/phases/phase-<n>-review.md` for the approved scope
  - `docs/modules/_template/brief.md`
  - the feature files for the module's IDs, and `docs/features/00-INDEX.md`
  - the ADRs that constrain the module, and `CLAUDE.md`
- Load skills (per `docs/process/skills-map.md`):
  - `product-management:write-spec` for the brief
  - `engineering:system-design` and `engineering:architecture` for G2

## 2. Draft the brief (Hadi, product-owner)
Fill `docs/modules/<module>/brief.md` (Persian) from the template:
- goal and roles (platform-operator / tenant-staff / portal-user)
- scope by feature ID, in and out, and AI uses
- key flows, and hard rules (one per line)
- data ownership, facades and events
- tenant, site, organisation, time-zone and calendar dimensions
- section 7: one owner decision per row, each with the team's recommendation
- risks, NFRs and acceptance criteria

Never invent business rules. Anything missing from the spec becomes an owner question.

## 3. G1: scope and capabilities (owner + Hadi + Ali, plus Jafar if there is UI)
1. Ali (cto) reviews the brief for ADR conflicts and scope, following `phoenix-role-review`.
2. Send the owner a short Persian summary.
3. Ask the section 7 questions **one at a time** as decision cards (AskUserQuestion or the
   host's decision-card tool), recommended option first.
4. Record the answers with date in section 7.
5. Record the G1 result and date in the brief's approvals table and `docs/modules/README.md`.

## 4. Design and G2 (Mohammad, Mojtaba, Reza; reviewed by Ali, plus Hassan for tier A)
1. Mohammad: domain model, state machines, boundary, facades and events, enforcement points.
   Mojtaba: physical schema, RLS policies, migration approach. Reza and Jafar: flows and
   screens, if the module has UI.
2. Ali reviews. Hassan reviews tier A and any mandatory security path.
3. Persian summary to the owner, with a diagram for complex flows (`artifact-diagramming`).
   Ask only the questions that need an owner decision.
4. Write an ADR only when a decision crosses modules (reserve the number on the board).
5. Record the G2 result and date.

## 5. After the gates
- Hadi writes stories only from the approved brief.
- The module folder moves from the `product` track to the building track; record it on the board.
- If scope or a hard rule changes during coding, stop, run a mini-review
  (`operations:change-request`) and record it in the brief's change log.
- Javad checks the next module's brief is being prepared in parallel.
- Commit following `phoenix-repo-doc-change`.
