import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ACCOUNTS_MANAGE } from '../../contracts/permissions';
import { ACCOUNT_DISABLED } from '../../domain/audit-actions';
import type { AccountRepository } from '../account.repository';
import {
  ACCOUNT_NOT_FOUND,
  type AccountNotFound,
  type AccountNotLocal,
  type OwnAccount,
} from '../failures';
import type { SessionRepository } from '../session.repository';

export interface DisableStaffAccountInput {
  readonly accountId: Id<'Account'>;
  readonly version: number;
}

export type DisableStaffAccountFailure = AccountNotFound | AccountNotLocal | OwnAccount;

/**
 * Disables a local staff account and ends all its sessions in one unit (ADR-0004 decision 2,
 * PoC 2 verdict 4): the next request with any of its cookies is refused, and its next sign-in
 * too. A directory account is disabled in the directory; the sync applies it (ADR-0022
 * decision 2). Disabling an already disabled account changes nothing.
 */
export class DisableStaffAccount extends UseCase<
  DisableStaffAccountInput,
  { sessionsEnded: number },
  DisableStaffAccountFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.disable-staff-account',
    rule: { kind: 'permissions', allOf: [IDENTITY_ACCOUNTS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: DisableStaffAccountInput,
  ): Promise<Result<{ sessionsEnded: number }, DisableStaffAccountFailure>> {
    const { tenant, actor } = context;
    if (actor.kind === 'authenticated' && actor.accountId === input.accountId) {
      return Promise.resolve(err({ code: 'identity.account.own-account' } as const));
    }
    return this.unitOfWork.run<{ sessionsEnded: number }, DisableStaffAccountFailure>(
      tenant,
      async () => {
        const account = await this.accounts.find(tenant, input.accountId);
        if (account === null || account.population !== 'tenant-staff') {
          return err(ACCOUNT_NOT_FOUND);
        }
        if (account.source !== 'local') return err({ code: 'identity.account.not-local' } as const);
        if (account.version !== input.version) {
          throw new StaleAggregateError('identity.account', account.id);
        }
        if (account.status === 'disabled') return ok({ sessionsEnded: 0 });
        await this.accounts.disable(tenant, account.id, account.version, this.clock.now());
        const sessionsEnded = await this.sessions.endAllOf(tenant, account.id);
        await this.audit.record(
          context,
          ACCOUNT_DISABLED.entry(account.id, { after: { sessionsEnded } }),
        );
        return ok({ sessionsEnded });
      },
    );
  }
}
