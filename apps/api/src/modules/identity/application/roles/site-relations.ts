import type { CallContext, Id } from '@phoenix/shared-kernel';
import {
  siteRelation,
  type SiteAncestryReader,
  type SiteRelation,
} from '../../../../platform/authz';
import type { AssignmentRecord } from './role.repository';

/**
 * For each site grant of the actor on another site, the relation of `siteId` to that grant's
 * site (ADR-0018 decision 6), for `decideGrant`. Each answer opens a read-only unit of the
 * tenancy module, so this runs before the use case's unit; a reader that throws makes it throw.
 */
export async function siteRelationsFor(
  reader: SiteAncestryReader,
  context: CallContext,
  actorAssignments: readonly AssignmentRecord[],
  siteId: Id<'Site'>,
): Promise<Map<Id<'Site'>, SiteRelation>> {
  const roots = new Set(
    actorAssignments.flatMap((a) =>
      a.level === 'site' && a.siteId !== null && a.siteId !== siteId ? [a.siteId] : [],
    ),
  );
  const relations = new Map<Id<'Site'>, SiteRelation>();
  for (const root of roots) {
    relations.set(root, await siteRelation(reader, context, siteId, root));
  }
  return relations;
}
