// Ported from Mondapac apps/api/test/boundary-fixtures/prisma/passing/src/platform/persistence/audit/writer.ts.
// Allowed: the audit models are reserved to platform/persistence/audit/, which names them
// through auditTx(tenant), by property and by destructuring.
declare function auditTx(
  tenant: unknown,
): Record<string, { create(args: unknown): Promise<unknown> }>;
declare const tenant: unknown;

export async function write(): Promise<void> {
  await auditTx(tenant).auditLog.create({});
  const { auditLog } = auditTx(tenant);
  await auditLog.create({});
}
