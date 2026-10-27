// SPIKE: the content module's persistence port.
import type { TenantContext } from '@phoenix/shared-kernel';

export interface ContentSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

export interface ContentStore {
  latestOfSite(tenant: TenantContext, siteId: string, take: number): Promise<ContentSummary[]>;
}

export const CONTENT_STORE = Symbol('CONTENT_STORE');
