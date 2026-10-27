import { mint } from './minted';

export interface TenantContext {
  readonly tenantId: string;
}

export function mintTenantContext(tenantId: string): TenantContext {
  return mint({ tenantId });
}
