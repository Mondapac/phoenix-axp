import { Temporal } from '@phoenix/shared-kernel';
import {
  canAssign,
  canClaim,
  canComplete,
  canRelease,
  canSee,
  deadlinePassed,
  eligibleAssignee,
  inInbox,
  type HoldingAtSite,
  type TaskAssignment,
} from './task-access';

// Who may act on an inbox task (ADR-0025; owner decision D3). Holdings arrive already resolved
// against the task's site; the rules never read input for ownership.

const WORK = 'process.tasks.work';
const ASSIGN = 'process.tasks.assign';
const KEYS = { work: WORK, assign: ASSIGN };
const now = Temporal.Instant.from('2026-11-04T12:00:00Z');
const later = now.add({ hours: 1 });

const queued: TaskAssignment = {
  status: 'open',
  candidateRoleId: 'reviewer',
  assigneeAccountId: null,
  dueAt: later,
  escalationRoleId: 'manager',
  escalatedAt: null,
};
const holding = (roleId: string, keys: string[], coversSite = true): HoldingAtSite => ({
  roleId,
  keys: new Set(keys),
  coversSite,
});
const reviewerHere = [holding('reviewer', [WORK])];
const reviewerElsewhere = [holding('reviewer', [WORK], false)];

describe('claiming and completing from a queue', () => {
  it('lets a holder of the queue role with the work key at the site claim and complete', () => {
    expect(canClaim(queued, reviewerHere, WORK, now)).toBe(true);
    expect(canComplete(queued, 'a-1', reviewerHere, WORK, now)).toBe(true);
    expect(inInbox(queued, 'a-1', reviewerHere, WORK, now)).toBe(true);
  });

  it('refuses a grant at another site, another role, or a role without the work key', () => {
    expect(canClaim(queued, reviewerElsewhere, WORK, now)).toBe(false);
    expect(canClaim(queued, [holding('clerk', [WORK])], WORK, now)).toBe(false);
    expect(canClaim(queued, [holding('reviewer', [])], WORK, now)).toBe(false);
    // The key from one grant and the role from a grant elsewhere do not add up.
    expect(
      canClaim(queued, [holding('reviewer', [], true), holding('x', [WORK], false)], WORK, now),
    ).toBe(false);
  });

  it('keeps a held task to its holder', () => {
    const held = { ...queued, assigneeAccountId: 'a-1' };
    expect(canClaim(held, reviewerHere, WORK, now)).toBe(false);
    expect(canComplete(held, 'a-1', reviewerHere, WORK, now)).toBe(true);
    expect(canComplete(held, 'a-2', reviewerHere, WORK, now)).toBe(false);
    expect(inInbox(held, 'a-2', reviewerHere, WORK, now)).toBe(false);
    expect(canRelease(held, 'a-1')).toBe(true);
    expect(canRelease(held, 'a-2')).toBe(false);
  });

  it('takes a held queued task back once its holder lost the queue role', () => {
    const held = { ...queued, assigneeAccountId: 'a-1' };
    const clerkOnly = [holding('clerk', [WORK])];
    expect(canComplete(held, 'a-1', clerkOnly, WORK, now)).toBe(false);
    expect(inInbox(held, 'a-1', clerkOnly, WORK, now)).toBe(false);
    expect(eligibleAssignee(held, clerkOnly, WORK)).toBe(false);
  });

  it('never releases a task sent straight to a person', () => {
    const direct = { ...queued, candidateRoleId: null, assigneeAccountId: 'a-1' };
    expect(canRelease(direct, 'a-1')).toBe(false);
    expect(canComplete(direct, 'a-1', reviewerHere, WORK, now)).toBe(true);
  });

  it('shows a completing task to its holder only, and lets nobody act on it', () => {
    const completing = { ...queued, status: 'completing' as const, assigneeAccountId: 'a-1' };
    expect(inInbox(completing, 'a-1', reviewerHere, WORK, now)).toBe(true);
    expect(canComplete(completing, 'a-1', reviewerHere, WORK, now)).toBe(false);
    expect(canRelease(completing, 'a-1')).toBe(false);
  });
});

describe('deadlines (PoC 3 R7: the deadline wins)', () => {
  it('closes the first queue once an escalating deadline passed', () => {
    expect(deadlinePassed(queued, later)).toBe(true);
    expect(canClaim(queued, reviewerHere, WORK, later)).toBe(false);
    expect(
      canComplete({ ...queued, assigneeAccountId: 'a-1' }, 'a-1', reviewerHere, WORK, later),
    ).toBe(false);
  });

  it('only marks a deadline without an escalation, and stops after the escalation', () => {
    expect(deadlinePassed({ ...queued, escalationRoleId: null }, later)).toBe(false);
    expect(deadlinePassed({ ...queued, escalatedAt: now }, later)).toBe(false);
  });
});

describe('supervising and seeing', () => {
  it('lets a holder of the assign key at the site give the task to an eligible person', () => {
    expect(canAssign([holding('lead', [ASSIGN])], ASSIGN)).toBe(true);
    expect(canAssign([holding('lead', [ASSIGN], false)], ASSIGN)).toBe(false);
    expect(eligibleAssignee(queued, reviewerHere, WORK)).toBe(true);
    expect(eligibleAssignee(queued, [holding('clerk', [WORK])], WORK)).toBe(false);
    expect(
      eligibleAssignee({ ...queued, candidateRoleId: null }, [holding('clerk', [WORK])], WORK),
    ).toBe(true);
  });

  it('hides a task from anybody without the queue role, the task or the site', () => {
    expect(canSee(queued, 'a-1', reviewerHere, KEYS)).toBe(true);
    expect(canSee(queued, 'a-1', reviewerElsewhere, KEYS)).toBe(false);
    expect(canSee(queued, 'a-1', [holding('clerk', [WORK])], KEYS)).toBe(false);
    expect(canSee(queued, 'a-1', [holding('lead', [ASSIGN])], KEYS)).toBe(true);
    expect(
      canSee(
        { ...queued, assigneeAccountId: 'a-1', candidateRoleId: null },
        'a-1',
        [holding('clerk', [WORK])],
        KEYS,
      ),
    ).toBe(true);
  });
});
