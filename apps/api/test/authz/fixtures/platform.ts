// Ported from Mondapac apps/api/test/authz/fixtures/platform.ts. The platform pieces the
// discovery fixtures use, from the real `platform/authz`: the check recognises `UseCase` by its
// declaration, so the fixtures extend the real class.
export { declarePermissions, definePermission } from '../../../src/platform/authz/permission';
export type { AccessDeclaration, PermissionKey } from '../../../src/platform/authz/access-rule';
export { UseCase } from '../../../src/platform/authz/use-case';
export type { CallContext, Result } from '@phoenix/shared-kernel';
export { ok, Temporal } from '@phoenix/shared-kernel';
export { registerJobs, type JobDefinition } from '../../../src/platform/scheduler/job-registry';
