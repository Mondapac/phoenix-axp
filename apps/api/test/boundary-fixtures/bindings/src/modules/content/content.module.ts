// Bindings of the content module: the first block is allowed, every later line breaks the rule
// (boundaries.spec.ts expects each one, and nothing else).
import {
  PersistenceModule,
  registerAuditActions,
  registerJobsFrom,
  registerPermissions as permit,
  registerSubscriptionsFrom,
} from './platform-stubs';

declare const catalogue: unknown[];
const name = 'content';

// Allowed: content binds its own name.
export const own = [
  PersistenceModule.outboxWriterFor('content'),
  PersistenceModule.auditWriterFor('content'),
  registerSubscriptionsFrom('content', [], () => []),
  registerAuditActions('content', catalogue),
  registerJobsFrom('content', [], () => []),
];

// Violations: another module's name, the platform's name, a name that is not a literal.
export const forged = [
  PersistenceModule.auditWriterFor('identity'),
  PersistenceModule.outboxWriterFor('identity'),
  registerSubscriptionsFrom('identity', [], () => []),
  registerAuditActions('identity', catalogue),
  registerJobsFrom('identity', [], () => []),
  PersistenceModule.auditWriterFor('platform.authz'),
  PersistenceModule.outboxWriterFor(name),
  registerAuditActions(`${name}`, catalogue),
  PersistenceModule['auditWriterFor']('identity'),
];

// Violations: the binding passed around, so its call cannot be read.
export const writerFor = PersistenceModule.auditWriterFor;
export const { outboxWriterFor } = PersistenceModule;
export const permissions = permit('content', catalogue);
