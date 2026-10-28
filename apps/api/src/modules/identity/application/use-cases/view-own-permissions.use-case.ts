import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type ActorGrantReader,
  type UseCaseGate,
} from '../../../../platform/authz';

/** The permission keys the caller holds through one site grant. */
export interface OwnSitePermissions {
  readonly siteId: Id<'Site'>;
  readonly includeDescendants: boolean;
  readonly keys: readonly string[];
}

/** The permission keys the caller holds: tenant-wide, and per site grant. Keys sorted. */
export interface OwnPermissions {
  readonly tenant: readonly string[];
  readonly sites: readonly OwnSitePermissions[];
}

/**
 * The permission keys of the caller's grants, which the panels build their menu from
 * (slice 1.10). A display aid only: every use case still passes the gate, so a menu entry the
 * caller sees and a request it may make are decided separately. `own-resources`: the grants are
 * read from the actor's session, never from input; an actor with none answers empty lists.
 */
export class ViewOwnPermissions extends UseCase<void, OwnPermissions, never> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.view-own-permissions',
    rule: { kind: 'own-resources' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly grants: ActorGrantReader,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<OwnPermissions, never>> {
    const tenant = new Set<string>();
    const sites: OwnSitePermissions[] = [];
    for (const grant of await this.grants.grantsOf(context)) {
      if (grant.scope.level === 'tenant') {
        for (const key of grant.keys) tenant.add(key);
      } else if (grant.scope.level === 'site') {
        sites.push({
          siteId: grant.scope.siteId,
          includeDescendants: grant.scope.includeDescendants,
          keys: [...grant.keys].sort(),
        });
      }
    }
    return ok({ tenant: [...tenant].sort(), sites });
  }
}
