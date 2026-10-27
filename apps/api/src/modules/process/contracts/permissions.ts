import { declarePermissions, definePermission } from '../../../platform/authz';

// The permissions of the process module (Phoenix ADR-0004 decision 6). Designing a process and
// publishing it are separate permissions (owner decision D7, phase 2 review); the design side
// arrives with the modeler (slice 2.10). Tenant scope: a process runs for the whole tenant.

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

export const PROCESS_PERMISSIONS = declarePermissions('process', [
  PROCESS_DEFINITIONS_PUBLISH,
  PROCESS_INCIDENTS_VIEW,
]);
