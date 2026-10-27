// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/application/use-cases/find-thing.use-case.ts.
import type { ThingRepository } from '../thing.repository';
import { thingService } from '../thing.service';

// Allowed: a use case reads its repository port and other application files.
export const findThing = (repository: ThingRepository) => [repository, thingService];
