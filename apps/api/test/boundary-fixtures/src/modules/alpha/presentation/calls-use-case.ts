// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/presentation/calls-use-case.ts.
import { findThing } from '../application/use-cases/find-thing.use-case';

// Allowed (use-cases-are-the-only-way-in): an entry point reaches application/ through a use
// case.
export const allowed = findThing;
