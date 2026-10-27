import type { DepthExceeded, MoveIntoOwnSubtree } from '../domain/tree';
import type { InvalidValue } from '../domain/values';

// The expected failures of the tenancy use cases: codes, and for a value its field name, never
// the value itself. The controllers map each code to its HTTP status.

export type SiteNotFound = { readonly code: 'tenancy.site.not-found' };
export type OrganizationNotFound = { readonly code: 'tenancy.organization.not-found' };
export type SiteDomainNotFound = { readonly code: 'tenancy.site-domain.not-found' };
export type SlugTaken = { readonly code: 'tenancy.site.slug-taken' };
export type SiteDomainTaken = { readonly code: 'tenancy.site-domain.taken' };
/** A lower site ceiling would cut off sites that already exist. */
export type DepthBelowTree = { readonly code: 'tenancy.tenant-settings.depth-below-tree' };

export type { DepthExceeded, InvalidValue, MoveIntoOwnSubtree };

export const SITE_NOT_FOUND: SiteNotFound = Object.freeze({ code: 'tenancy.site.not-found' });
export const ORGANIZATION_NOT_FOUND: OrganizationNotFound = Object.freeze({
  code: 'tenancy.organization.not-found',
});
export const SITE_DOMAIN_NOT_FOUND: SiteDomainNotFound = Object.freeze({
  code: 'tenancy.site-domain.not-found',
});
