// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/alpha.module.ts.
import { PrismaThingRepository } from './infrastructure/prisma-thing.repository';

// Allowed: the module's Nest module binds the repository implementation to its port.
export const providers = [PrismaThingRepository];
