// Allowed: words that merely contain a tenant literal are not one ("demo-fast", "en-CAD").
export function clean(tenantId: string): string {
  return `tenant ${tenantId} demo-fast en-CAD audit`;
}
