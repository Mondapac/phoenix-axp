// Violations (no-tenant-literals): a tenant id, a time zone and a locale of a tenant fixture,
// in a string and in a template. Tenants are configuration, never a branch in core code.
export function violation(tenantId: string): string {
  return tenantId === 'demo-fa' ? 'Asia/Tehran' : `formatted for en-CA in ${tenantId}`;
}
