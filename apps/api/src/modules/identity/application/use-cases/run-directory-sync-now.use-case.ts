import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import { IDENTITY_ACCOUNTS_MANAGE } from '../../contracts/permissions';
import type { DirectorySyncRunner, SyncSummary } from '../directory-sync-runner';

/**
 * Studio's "sync now" (ADR-0022 decision 6): runs the tenant's directory sync at once, whatever
 * the interval, and answers its summary; `skipped` only when another run claimed the tenant
 * at the same moment. Overlapping runs are safe: every change is conditional.
 */
export class RunDirectorySyncNow extends UseCase<void, SyncSummary> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.run-directory-sync-now',
    rule: { kind: 'permissions', allOf: [IDENTITY_ACCOUNTS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly runner: DirectorySyncRunner,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<SyncSummary, never>> {
    return ok(await this.runner.run(context, 'requested'));
  }
}
