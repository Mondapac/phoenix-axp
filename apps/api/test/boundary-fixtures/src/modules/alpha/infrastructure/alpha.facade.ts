// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/infrastructure/alpha.facade.ts.
import { thingService } from '../application/thing.service';

// Violation (use-cases-are-the-only-way-in): a facade implementation is an entry point; each
// method is a thin call of one use case, never of another application file.
export const violation = thingService;
