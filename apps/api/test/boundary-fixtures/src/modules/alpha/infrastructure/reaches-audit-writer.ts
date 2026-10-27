// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/infrastructure/reaches-audit-writer.ts.
import { createAuditWriter } from '../../../platform/persistence/audit/prisma-audit-writer';

// Violation (persistence-root-is-private; Mondapac platform-audit.md 2 and 16 "no module imports
// platform/persistence/audit"): a module's infrastructure cannot build a writer for any owner,
// its own included; it injects the AUDIT_WRITER its Nest module bound.
export const violation = createAuditWriter('beta');
