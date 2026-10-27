// Phoenix ADR-0010 decision 2: the fail-closed placeholder of the tenancy module's subtree
// answer, bound by AuthzModule until the tenancy module (Phase 1, after PoC 1) binds its own
// reader of `site_ancestry`. One binding PR replaces it (decision 5).
import { Injectable } from '@nestjs/common';
import { FailClosedPlaceholder } from '../../placeholders/placeholder-markers';
import type { SiteAncestryReader } from '../site-scope';

/**
 * Always "not within": no site-scope grant reaches a descendant, so access stays at the
 * granted site itself and a subtree grant can never be handed down; and no site exists, so
 * no site grant is made and no subtree lists a site. Constant: it reads no configuration and no environment.
 */
@FailClosedPlaceholder('tenancy.isWithinSubtree')
@Injectable()
export class FailClosedSiteAncestryReader implements SiteAncestryReader {
  siteExists(): Promise<false> {
    return Promise.resolve(false);
  }

  isWithinSubtree(): Promise<false> {
    return Promise.resolve(false);
  }

  sitesWithin(): Promise<never[]> {
    return Promise.resolve([]);
  }
}
