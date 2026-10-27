// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/presentation/jobs/reaches-repository.ts.
import { PrismaThingRepository } from '../../infrastructure/prisma-thing.repository';

// Violation (repositories-stay-behind-use-cases): a job handler never imports a repository; it
// calls one use case whose access rule is `system`.
export const violation = PrismaThingRepository;
