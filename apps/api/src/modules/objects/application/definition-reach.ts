import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Id } from '@phoenix/shared-kernel';
import {
  grantsCoverSite,
  type ActorGrantReader,
  type PermissionKey,
  type SiteAncestryReader,
} from '../../../platform/authz';
import type { UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import type { DefinitionRecord, DefinitionRepository } from './definition.repository';

/**
 * Where the actor's definition keys reach (ADR-0018 decision 6), as `FormReach` for forms: after
 * the gate has admitted the actor for a key held anywhere, a use case checks the definition's
 * site against the grants that confer the key. A definition outside the actor's reach answers
 * as one that does not exist. The ports read in units of their own, so this runs before the
 * use case's unit, never inside it.
 */
export class DefinitionReach {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly grants: ActorGrantReader,
    private readonly sites: SiteAncestryReader,
  ) {}

  /** True when a grant of the actor that confers `key` covers `siteId`. */
  async covers(context: CallContext, key: PermissionKey, siteId: Id<'Site'>): Promise<boolean> {
    return grantsCoverSite(await this.grants.grantsOf(context), this.sites, context, key, siteId);
  }

  /** The definition, when it exists and `key` reaches its site; otherwise null. */
  async definition(
    context: CallContext,
    key: PermissionKey,
    id: Id<'ObjectDefinition'>,
  ): Promise<DefinitionRecord | null> {
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => ok(await this.definitions.find(tenant, id)),
      { readOnly: true },
    );
    if (!read.ok || read.value === null) return null;
    return (await this.covers(context, key, read.value.siteId)) ? read.value : null;
  }

  /** The definitions whose site `key` reaches, in their order. */
  async filter(
    context: CallContext,
    key: PermissionKey,
    definitions: readonly DefinitionRecord[],
  ): Promise<DefinitionRecord[]> {
    const grants = await this.grants.grantsOf(context);
    const reached = new Map<string, boolean>();
    const kept: DefinitionRecord[] = [];
    for (const definition of definitions) {
      let covered = reached.get(definition.siteId);
      if (covered === undefined) {
        covered = await grantsCoverSite(grants, this.sites, context, key, definition.siteId);
        reached.set(definition.siteId, covered);
      }
      if (covered) kept.push(definition);
    }
    return kept;
  }
}

export const DEFINITION_REACH = Symbol('DEFINITION_REACH');
