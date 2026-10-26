// Violation: beta's infrastructure names alpha's model.
declare const tx: Record<string, { findMany(args: unknown): Promise<unknown> }>;

export async function read(): Promise<void> {
  await tx.alphaParent.findMany({});
}
