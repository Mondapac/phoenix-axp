// The platform binds 'platform' or 'platform.<component>' only.
import {
  PersistenceModule,
  registerJobsFrom,
  registerPermissions,
} from '../../modules/content/platform-stubs';

// Allowed.
export const jobs = registerJobsFrom('platform', [], () => []);
export const component = registerJobsFrom('platform.audit', [], () => []);

// Violations: the platform poses as a module.
export const forged = PersistenceModule.auditWriterFor('identity');
export const permissions = registerPermissions('content', []);
