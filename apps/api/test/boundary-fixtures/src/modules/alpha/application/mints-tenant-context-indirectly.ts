import type * as factories from '../../../platform/tenant-context/tenant-context.factory';
import * as kernel from '@phoenix/shared-kernel';

// Violations: a re-export, a destructured name (also computed), a computed member and a
// qualified type all reach the minting names.
export { mintTenantContext } from '@phoenix/shared-kernel';
const { mintTenantContext: mint } = kernel;
const { ['mintTenantContext']: mintByLiteral } = kernel;

export function violation(factory: factories.TenantContextFactory): unknown[] {
  return [mint('zz'), mintByLiteral, kernel['mintTenantContext'], factory];
}
