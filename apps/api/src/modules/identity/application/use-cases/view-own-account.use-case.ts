import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Population, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import type { AccountSource } from '../../domain/account';
import type { AccountRepository } from '../account.repository';
import { ACCOUNT_NOT_FOUND, type AccountNotFound } from '../failures';

export interface OwnAccount {
  readonly accountId: Id<'Account'>;
  readonly population: Population;
  readonly source: AccountSource;
  readonly username: string;
}

/** Who the caller is signed in as: the panels' "me". `own-resources`, by the actor's id. */
export class ViewOwnAccount extends UseCase<void, OwnAccount, AccountNotFound> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.view-own-account',
    rule: { kind: 'own-resources' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: AccountRepository,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<OwnAccount, AccountNotFound>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') return Promise.resolve(err(ACCOUNT_NOT_FOUND));
    return this.unitOfWork.run<OwnAccount, AccountNotFound>(
      tenant,
      async () => {
        const account = await this.accounts.find(tenant, actor.accountId);
        if (account === null) return err(ACCOUNT_NOT_FOUND);
        return ok({
          accountId: account.id,
          population: account.population,
          source: account.source,
          username: account.username,
        });
      },
      { readOnly: true },
    );
  }
}
