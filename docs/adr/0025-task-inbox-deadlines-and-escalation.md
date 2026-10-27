# ADR-0025: Task Inbox: Assignment, Core-Owned Deadlines and Escalation

**Status:** Accepted — 2026-10-27, by `software-architect` and `cto` (slice 2.3; the rules come
from owner decisions D3, D4 and the PoC 3 R7 answer of the Phase 2 review)
**Amends:** ADR-0005 decision 4 (deadlines and escalation of user tasks)
**Relates to:** ADR-0004, ADR-0008, ADR-0018, ADR-0020, ADR-0024,
`docs/phases/phase-2-review.md` (D3, D4, R6, R7, slice 2.3)

## Context
Slice 2.3 builds "my tasks". The owner decided that a task reaches either a role's queue at the
instance's site (the default, one holder claims it) or one named person (D3); that a deadline is
counted in calendar or working days, chosen per deadline, against a holiday calendar each tenant
enters itself with no default source (D4); and that when a deadline passes, the deadline wins: a
late decision is not applied and is recorded as superseded (R7).

ADR-0005 left timers and escalation to Flowable. A boundary timer in the engine cannot see the
tenant's working calendar, cannot tell that a completion is already on its way through the
outbox, and would let the engine decide who holds a task, which the core owns.

## Decision
1. **The modeller sets assignment and deadlines as attributes of the user task**
   (`phoenixRole` or `phoenixAssignee`, `phoenixDue` as `P<n>D` up to 365 or `PT<n>H` up to 720,
   `phoenixDueDays` `calendar|working`, `phoenixEscalationRole`, `phoenixOutcomes`), each in a
   namespace of the modeller's own, as the BPMN schema requires of a foreign attribute. The BPMN
   intake check parses them at publication, refuses a bad one with
   `process.bpmn.task-setting-invalid` naming the attribute (never its value), and stores the
   result with the revision. Flowable ignores them. A stored setting is parsed again when read
   and fails closed to "no settings".
2. **The core owns deadlines and escalation of user tasks** (amends ADR-0005 decision 4). When
   the engine sync surfaces a task, the core computes `due_at` from `Clock` in the tenant's time
   zone; working days skip the tenant's weekend days and holidays and keep the time of day.
   Engine timers stay for process paths (boundary events the modeller draws), not for inbox
   deadlines.
3. **Escalation is a reassignment in the core.** A worker job (every 30 s) moves each open task
   past its deadline that names an escalation role to that role's queue at the same site, clears
   the assignee, sets `escalated_at` and audits `process.task.escalated`. One level only. A task
   without an escalation role is only marked overdue.
4. **The deadline wins (R7).** Once the deadline has passed, the first queue can no longer claim
   or complete (`409 process.task.unavailable`). A completion already accepted but still in the
   outbox when the deadline passes is not sent to the engine: the relay escalates the task,
   keeps the chosen outcome on the row, ends the command with `task.superseded`, records the
   incident `completion-superseded` and audits `process.task.completion-superseded`. Before it
   supersedes, the relay asks the engine: a completion the engine applied although its answer was
   lost is closed as completed, never superseded.
5. **Who may act** is decided in the core from the actor's role holdings resolved per site
   (ADR-0018, a null site is covered by tenant grants only): `process.tasks.work` to claim,
   release and complete (a held queued task also needs the queue's role, so a revoke takes it
   back), `process.tasks.assign` to see a site's tasks and assign them. A task the
   actor may not see answers "not found". Holdings come through the `identity.roleHoldingReader`
   port of `platform/authz`, fail-closed until identity binds it.
6. **Completion** goes only through the complete use case, which sends the chosen outcome to the
   engine as the reserved variable `phoenixOutcome`; nobody else may set it.
7. **The working calendar** is tenant data (`process.working_calendar`: weekend days and
   holidays), versioned, managed with `process.calendar.manage`, every change audited.
8. The inbox returns ids, codes and times only; task-form values arrive with slices 2.5 and 2.6
   and are projected through `FieldPolicy` (ADR-0024) with step narrowing.

## Consequences
- The engine never decides who holds a task or when it is late; the deadline rule is tested in
  the core on two tenant fixtures with different zones and calendars.
- Changing a tenant's calendar does not move deadlines already computed.
- A deadline counts from the moment the core sees the task, which can trail the engine by one
  sync interval.
- Mandatory security review: authorisation (holdings port, site scope) and the bridge.

## Alternatives considered
- **Flowable boundary timers for escalation:** rejected; no tenant working calendar, and a race
  with a completion already in the outbox that R7 forbids.
- **Candidate groups and assignee in Flowable:** rejected; the engine would hold assignment,
  which ADR-0005 gives to the core.
