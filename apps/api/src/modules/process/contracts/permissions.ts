import { declarePermissions, definePermission } from '../../../platform/authz';

// The permissions of the process module (Phoenix ADR-0004 decision 6). Designing a process and
// publishing it are separate permissions (owner decision D7, phase 2 review); the design side
// arrived with the modeler (slice 2.10). Publishing runs for the whole tenant (tenant scope);
// the task inbox works per site (site scope, ADR-0018): a site grant reaches the tasks of its
// site, and of the sites below it with `includeDescendants` (ADR-0025).

/**
 * Design processes: open the tenant's process models and save drafts in the modeler (D7).
 * A draft is never deployed; only a publisher turns it into a revision.
 */
export const PROCESS_DEFINITIONS_DESIGN = definePermission('process', {
  key: 'process.definitions.design',
  scope: 'tenant',
  protected: false,
});

/** Publish a process revision: it is deployed to the engine and can be started. */
export const PROCESS_DEFINITIONS_PUBLISH = definePermission('process', {
  key: 'process.definitions.publish',
  scope: 'tenant',
  protected: false,
});

/** Read the bridge's incidents (orphan instances, tasks completed outside the core). */
export const PROCESS_INCIDENTS_VIEW = definePermission('process', {
  key: 'process.incidents.view',
  scope: 'tenant',
  protected: false,
});

/**
 * Work the task inbox: see, claim, give back and complete the tasks of one's queues and one's
 * own. Which tasks is decided by the task's queue role and assignee, at the grant's sites.
 */
export const PROCESS_TASKS_WORK = definePermission('process', {
  key: 'process.tasks.work',
  scope: 'site',
  protected: false,
});

/** Supervise the inbox at the grant's sites: see every open task there and give one to a person. */
export const PROCESS_TASKS_ASSIGN = definePermission('process', {
  key: 'process.tasks.assign',
  scope: 'site',
  protected: false,
});

/** Enter the tenant's working calendar: weekend days and holidays (owner decision D4). */
export const PROCESS_CALENDAR_MANAGE = definePermission('process', {
  key: 'process.calendar.manage',
  scope: 'tenant',
  protected: false,
});

export const PROCESS_PERMISSIONS = declarePermissions('process', [
  PROCESS_DEFINITIONS_DESIGN,
  PROCESS_DEFINITIONS_PUBLISH,
  PROCESS_INCIDENTS_VIEW,
  PROCESS_TASKS_WORK,
  PROCESS_TASKS_ASSIGN,
  PROCESS_CALENDAR_MANAGE,
]);
