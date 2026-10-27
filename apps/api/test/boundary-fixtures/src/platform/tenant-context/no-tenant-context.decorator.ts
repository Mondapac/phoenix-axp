export const EXEMPTION_KEY = 'tenant-context-exemption';

export function NoTenantContext(): { key: string } {
  return { key: EXEMPTION_KEY };
}
