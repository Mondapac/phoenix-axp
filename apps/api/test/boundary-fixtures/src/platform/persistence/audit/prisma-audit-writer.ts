// Ported from Mondapac apps/api/test/boundary-fixtures/src/platform/persistence/audit/prisma-audit-writer.ts.
// The audit writer's implementation (Mondapac platform-audit.md 2): private to
// platform/persistence/. A module reaches only its own bound AUDIT_WRITER token.
export function createAuditWriter(owner: string): { readonly owner: string } {
  return { owner };
}
