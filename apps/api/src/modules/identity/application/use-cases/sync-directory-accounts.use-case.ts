import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { DirectorySyncRunner, SyncSummary } from '../directory-sync-runner';

/**
 * The scheduled staff directory sync of one tenant (ADR-0022 decision 6): runs when the
 * tenant's interval has passed since the last run. `system`: called by the
 * `identity.sync-directory-accounts` job only.
 */
export class SyncDirectoryAccounts extends UseCase<void, SyncSummary> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.sync-directory-accounts',
    rule: { kind: 'system' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly runner: DirectorySyncRunner,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<SyncSummary, never>> {
    return ok(await this.runner.run(context, 'scheduled'));
  }
}
