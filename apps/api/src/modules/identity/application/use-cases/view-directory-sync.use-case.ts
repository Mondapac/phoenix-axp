import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ACCOUNTS_VIEW } from '../../contracts/permissions';
import type { DirectorySyncRepository, DirectorySyncState } from '../directory-sync.repository';

/** The tenant's directory sync interval and the result of its last run. */
export class ViewDirectorySync extends UseCase<void, DirectorySyncState> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.view-directory-sync',
    rule: { kind: 'permissions', allOf: [IDENTITY_ACCOUNTS_VIEW.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly syncs: DirectorySyncRepository,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<DirectorySyncState, never>> {
    const { tenant } = context;
    return this.unitOfWork.run(tenant, async () => ok(await this.syncs.read(tenant)), {
      readOnly: true,
    });
  }
}
