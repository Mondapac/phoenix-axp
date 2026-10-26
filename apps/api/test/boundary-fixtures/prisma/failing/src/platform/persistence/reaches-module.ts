// Violations: platform/persistence/ names a module's model (platform owns platform.prisma
// only) and runs raw SQL outside the files of RAW_SQL_FILES.
declare const tx: Record<string, { findMany(args: unknown): Promise<unknown> }>;
declare const db: Record<string, (...args: unknown[]) => unknown>;

export async function read(): Promise<void> {
  await tx.platformProbe.findMany({});
  await tx.alphaParent.findMany({});
  await db.$queryRawUnsafe('SELECT 1');
}
