// SPIKE (PoC 1/2): the site module's public read of the tree (ADR-0018).
import type { TenantContext } from '@phoenix/shared-kernel';
import type { AncestorDepths } from '../domain/subtree-access';

export interface SiteTreeFacade {
  /** The ancestors of a site of the tenant, itself at depth 0; empty when it is not one. */
  ancestorsOf(tenant: TenantContext, siteId: string): Promise<AncestorDepths>;
}

export const SITE_TREE_FACADE = Symbol('SITE_TREE_FACADE');
