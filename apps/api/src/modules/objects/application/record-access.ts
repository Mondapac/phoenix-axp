import type { CallContext, Id } from '@phoenix/shared-kernel';
import {
  grantCoversDefinition,
  resolveFieldAccess,
  type FieldAccess,
  type FieldDescriptor,
  type FieldRuleReader,
  type PermissionKey,
  type SiteAncestryReader,
} from '../../../platform/authz';
import type { ObjectField } from '../domain/fields';
import type { SiteFilter } from './record.repository';

/**
 * The field descriptors of values written under `writtenUnder`, for FieldPolicy (ADR-0024
 * decision 5): a field is sensitive when that revision or the definition's current revision
 * marks it; the portal setting is the current one.
 */
export function descriptorsOf(
  writtenUnder: readonly ObjectField[],
  current: readonly ObjectField[] | null,
): FieldDescriptor[] {
  const now = new Map((current ?? []).map((field) => [field.id as string, field]));
  return writtenUnder.map((field) => {
    const latest = now.get(field.id);
    const sensitive = field.sensitive || latest?.sensitive === true;
    const portal = latest?.portal ?? field.portal;
    return portal === undefined ? { id: field.id, sensitive } : { id: field.id, sensitive, portal };
  });
}

/**
 * Record-level and field-level access to the records of one definition (ADR-0017 decision 5,
 * ADR-0024): tenant, then the record's site against the grants conferring the operation key,
 * then the definition qualifier, then the role's field rules, all through the one evaluator.
 * Reads committed grants in units of their own: call it before the use case's unit.
 */
export class RecordAccess {
  constructor(
    private readonly rules: FieldRuleReader,
    private readonly sites: SiteAncestryReader,
  ) {}

  /** The access of the caller to a record of `definitionId` owned by `siteId`. */
  at(
    context: CallContext,
    definitionId: Id<'ObjectDefinition'>,
    siteId: Id<'Site'>,
    operations: { readonly read: PermissionKey; readonly write: PermissionKey },
    fields: readonly FieldDescriptor[],
  ): Promise<FieldAccess> {
    return resolveFieldAccess(this.rules, this.sites, context, siteId, {
      definitionId: definitionId as string as Id<'Definition'>,
      operations,
      fields,
    });
  }

  /**
   * True when the caller's grants conferring `key` reach some record of the definition. A
   * record path answers an unreached definition as not found, exactly as an unknown key, so
   * no caller learns which keys exist (security review of slice 2.8, L1).
   */
  async reaches(
    context: CallContext,
    definition: { readonly id: Id<'ObjectDefinition'>; readonly siteId: Id<'Site'> },
    key: PermissionKey,
  ): Promise<boolean> {
    const sites = await this.sitesFor(context, definition, key);
    return sites === 'all' || sites.length > 0;
  }

  /** True when `siteId` is the definition's site or a site below it: where its records live. */
  async inDefinitionTree(
    context: CallContext,
    definition: { readonly siteId: Id<'Site'> },
    siteId: Id<'Site'>,
  ): Promise<boolean> {
    if (siteId === definition.siteId) return true;
    return this.sites.isWithinSubtree(context, siteId, definition.siteId);
  }

  /**
   * The sites where the caller's grants conferring `key` reach records of the definition owned
   * by `ownerSiteId`: `all` for a tenant grant, otherwise the covered sites of the definition's
   * subtree, so a list filters in its query and its pages are never short. Any actor but a
   * staff member reaches none.
   */
  async sitesFor(
    context: CallContext,
    definition: { readonly id: Id<'ObjectDefinition'>; readonly siteId: Id<'Site'> },
    key: PermissionKey,
  ): Promise<SiteFilter> {
    const { actor } = context;
    if (actor.kind !== 'authenticated' || actor.population !== 'tenant-staff') return [];
    const definitionId = definition.id as string as Id<'Definition'>;
    const covered = new Set<Id<'Site'>>();
    for (const grant of await this.rules.grantsFor(context, definitionId)) {
      if (!grant.keys.has(key) || !grantCoversDefinition(grant, key, definitionId)) continue;
      if (grant.scope.level === 'tenant') return 'all';
      if (grant.scope.level !== 'site') continue;
      const reached = grant.scope.includeDescendants
        ? await this.sites.sitesWithin(context, grant.scope.siteId)
        : [grant.scope.siteId];
      for (const site of reached) covered.add(site);
    }
    if (covered.size === 0) return [];
    // Records live in the definition's subtree; a grant elsewhere reaches none of them.
    const subtree = new Set(await this.sites.sitesWithin(context, definition.siteId));
    return [...covered].filter((site) => subtree.has(site)).sort();
  }
}

export const RECORD_ACCESS = Symbol('RECORD_ACCESS');
