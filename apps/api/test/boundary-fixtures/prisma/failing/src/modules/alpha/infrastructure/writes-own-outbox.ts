// Ported from Mondapac apps/api/test/boundary-fixtures/prisma/failing/src/modules/alpha/infrastructure/writes-own-outbox.ts.
// Violation: even the owning module writes its outbox only through OutboxWriter.
declare const tx: Record<string, { create(args: unknown): Promise<unknown> }>;

export async function append(): Promise<void> {
  await tx.alphaOutbox.create({});
}
