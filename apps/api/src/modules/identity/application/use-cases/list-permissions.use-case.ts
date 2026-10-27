import { ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';
import {
  UseCase,
  type AccessDeclaration,
  type PermissionDeclaration,
  type UseCaseGate,
} from '../../../../platform/authz';
import { IDENTITY_ROLES_VIEW } from '../../contracts/permissions';

/** The part of the permission registry this use case reads. */
export interface PermissionListing {
  list(): readonly PermissionDeclaration[];
}

/**
 * The staff permission catalogue a custom role may draw from: the tenant and site keys, by
 * key, with whether each is protected. Platform keys are the platform team's and stay out.
 */
export class ListPermissions extends UseCase<void, PermissionDeclaration[]> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.list-permissions',
    rule: { kind: 'permissions', allOf: [IDENTITY_ROLES_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly permissions: PermissionListing,
  ) {
    super(gate);
  }

  protected handle(): Promise<Result<PermissionDeclaration[], never>> {
    return Promise.resolve(
      ok(this.permissions.list().filter((declaration) => declaration.scope !== 'platform')),
    );
  }
}
