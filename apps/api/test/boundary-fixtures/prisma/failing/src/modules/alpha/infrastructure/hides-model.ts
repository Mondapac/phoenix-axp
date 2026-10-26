// Violations: a model of another module hidden from the property check by destructuring or
// by a computed key on a tx(...) result.
type View = Record<string, { findMany(args: unknown): Promise<unknown> }>;
declare const prisma: { tx(tenant: unknown): View };
declare const tenant: unknown;
declare const key: string;

export async function hide(): Promise<void> {
  const { betaThing } = prisma.tx(tenant);
  const { ['betaThing']: quoted, platformProbe: probe } = prisma.tx(tenant);
  const { [key]: computed } = prisma.tx(tenant);
  await prisma.tx(tenant)[key]!.findMany({});
  void [betaThing, quoted, probe, computed];
}
