import { Temporal } from '@phoenix/shared-kernel';
import type { TaskStatus } from './task';

/**
 * Who may act on a task of the inbox (ADR-0025; owner decision D3): the core decides, the
 * engine never does. Pure rules over the actor's role holdings, each already resolved against
 * the task's site (`coversSite`, from `grantCoversSite` of platform/authz). The order of the
 * checks is tenant (the unit), site, then the task's assignment.
 */

/** One role assignment of an account, as it stands to the task's site. */
export interface HoldingAtSite {
  readonly roleId: string;
  /** Every key the role confers. */
  readonly keys: ReadonlySet<string>;
  /** The assignment covers the task's site (a tenant grant covers every site). */
  readonly coversSite: boolean;
}

/** The assignment of a task as the inbox reads it. */
export interface TaskAssignment {
  readonly status: TaskStatus;
  /** The queue: a role at the instance's site; null for a task sent to one person. */
  readonly candidateRoleId: string | null;
  /** Who holds it: claimed from the queue, assigned, or the modeller's direct assignee. */
  readonly assigneeAccountId: string | null;
  readonly dueAt: Temporal.Instant | null;
  readonly escalationRoleId: string | null;
  readonly escalatedAt: Temporal.Instant | null;
}

const holdsKey = (holdings: readonly HoldingAtSite[], key: string): boolean =>
  holdings.some((holding) => holding.coversSite && holding.keys.has(key));

const holdsRole = (holdings: readonly HoldingAtSite[], roleId: string | null): boolean =>
  roleId !== null && holdings.some((holding) => holding.coversSite && holding.roleId === roleId);

/**
 * The deadline won (owner decision on PoC 3 R7): the task escalates and nobody of the first
 * queue may decide it any more. Only a task with an escalation role escalates; without one a
 * deadline only marks the task overdue.
 */
export const deadlinePassed = (task: TaskAssignment, now: Temporal.Instant): boolean =>
  task.escalationRoleId !== null &&
  task.escalatedAt === null &&
  task.dueAt !== null &&
  Temporal.Instant.compare(now, task.dueAt) >= 0;

export const isOverdue = (task: TaskAssignment, now: Temporal.Instant): boolean =>
  task.dueAt !== null && Temporal.Instant.compare(now, task.dueAt) >= 0;

/**
 * Whether `accountId`, holding `holdings`, may claim the open task: it waits in a queue of a
 * role the account holds at the site, and the account holds the work key there.
 */
export function canClaim(
  task: TaskAssignment,
  holdings: readonly HoldingAtSite[],
  workKey: string,
  now: Temporal.Instant,
): boolean {
  return (
    task.status === 'open' &&
    task.assigneeAccountId === null &&
    !deadlinePassed(task, now) &&
    holdsKey(holdings, workKey) &&
    holdsRole(holdings, task.candidateRoleId)
  );
}

/** Whether the account may complete the open task: it holds it, or may claim it now. */
export function canComplete(
  task: TaskAssignment,
  accountId: string,
  holdings: readonly HoldingAtSite[],
  workKey: string,
  now: Temporal.Instant,
): boolean {
  if (task.status !== 'open' || deadlinePassed(task, now)) return false;
  if (task.assigneeAccountId === accountId) return holdsKey(holdings, workKey);
  return canClaim(task, holdings, workKey, now);
}

/** Only a task claimed from a queue goes back to it; a direct assignment stays. */
export const canRelease = (task: TaskAssignment, accountId: string): boolean =>
  task.status === 'open' && task.assigneeAccountId === accountId && task.candidateRoleId !== null;

/** Whether the account supervises the task's site: it holds the assign key there. */
export const canAssign = (holdings: readonly HoldingAtSite[], assignKey: string): boolean =>
  holdsKey(holdings, assignKey);

/**
 * Whether another account may be given the task: it holds the work key at the site and, for a
 * queued task, the queue's role there.
 */
export function eligibleAssignee(
  task: TaskAssignment,
  holdings: readonly HoldingAtSite[],
  workKey: string,
): boolean {
  if (!holdsKey(holdings, workKey)) return false;
  return task.candidateRoleId === null || holdsRole(holdings, task.candidateRoleId);
}

/** Whether the task shows in the account's own inbox: it holds the task, or may claim it. */
export function inInbox(
  task: TaskAssignment,
  accountId: string,
  holdings: readonly HoldingAtSite[],
  workKey: string,
  now: Temporal.Instant,
): boolean {
  if (task.assigneeAccountId === accountId) {
    return (task.status === 'open' || task.status === 'completing') && holdsKey(holdings, workKey);
  }
  return canClaim(task, holdings, workKey, now);
}

/**
 * Whether the task exists for the account at all: it supervises the site, or holds the work key
 * there and holds the task or its queue's role. Any other task answers "not found" (ADR-0004
 * decision 5): another site's or queue's task is not revealed.
 */
export function canSee(
  task: TaskAssignment,
  accountId: string,
  holdings: readonly HoldingAtSite[],
  keys: { readonly work: string; readonly assign: string },
): boolean {
  if (holdsKey(holdings, keys.assign)) return true;
  if (!holdsKey(holdings, keys.work)) return false;
  return task.assigneeAccountId === accountId || holdsRole(holdings, task.candidateRoleId);
}
