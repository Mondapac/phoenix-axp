// Allowed: a spec binds any module on purpose (spec files are not checked). An .mts spec, so
// that Jest does not run this fixture as a test file.
import { PersistenceModule } from './platform-stubs';

export const binding = PersistenceModule.auditWriterFor('identity');
