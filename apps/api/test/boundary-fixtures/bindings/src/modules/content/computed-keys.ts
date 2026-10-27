// Violations: a key that is not a string literal can name a binding the check cannot see, on
// PersistenceModule or on a namespace import (boundaries.spec.ts expects each line below).
import * as stubs from './platform-stubs';
import { PersistenceModule } from './platform-stubs';

declare const catalogue: unknown[];
const key = 'auditWriterFor';
const part = 'Writer';

export const computed = [
  PersistenceModule[key]('identity'),
  PersistenceModule['audit' + 'WriterFor']('identity'),
  PersistenceModule[`audit${part}For`]('identity'),
  stubs['register' + 'Permissions']('identity', catalogue),
];
export const { [key]: writer } = PersistenceModule;

// Allowed: a namespace import called by name binds content's own name.
export const own = stubs.registerPermissions('content', catalogue);
