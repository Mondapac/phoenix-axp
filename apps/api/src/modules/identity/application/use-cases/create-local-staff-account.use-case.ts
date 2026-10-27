import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { IDENTITY_ACCOUNTS_MANAGE } from '../../contracts/permissions';
import { parseUsername } from '../../domain/account';
import { ACCOUNT_CREATED } from '../../domain/audit-actions';
import type { AccountRepository } from '../account.repository';
import type { InvalidUsername, UsernameTaken } from '../failures';

export interface CreateLocalStaffAccountInput {
  readonly username: string;
}

/**
 * Creates a local staff account (ADR-0019 decision 3) with no roles, before its first sign-in:
 * the realm's local user of the same username is linked to it then. The Keycloak user itself
 * is created by the tenant's identity administrator.
 */
export class CreateLocalStaffAccount extends UseCase<
  CreateLocalStaffAccountInput,
  { id: Id<'Account'> },
  InvalidUsername | UsernameTaken
> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.create-local-staff-account',
    rule: { kind: 'permissions', allOf: [IDENTITY_ACCOUNTS_MANAGE.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly accounts: AccountRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected handle(
    context: CallContext,
    input: CreateLocalStaffAccountInput,
  ): Promise<Result<{ id: Id<'Account'> }, InvalidUsername | UsernameTaken>> {
    const username = parseUsername(input.username);
    if (!username.ok) return Promise.resolve(username);
    const id = this.ids.next<'Account'>();
    const { tenant } = context;
    return this.unitOfWork.run<{ id: Id<'Account'> }, InvalidUsername | UsernameTaken>(
      tenant,
      async () => {
        const created = await this.accounts.insert(
          tenant,
          { id, source: 'local', subject: null, username: username.value },
          this.clock.now(),
        );
        if (created === 'taken') {
          return err({ code: 'identity.account.username-taken' } as const);
        }
        await this.audit.record(context, ACCOUNT_CREATED.entry(id, { after: { source: 'local' } }));
        return ok({ id });
      },
    );
  }
}
