import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { maskAddress, type PortalMethod } from '../../domain/portal';
import { ACCOUNT_NOT_FOUND, type AccountNotFound } from '../failures';
import type { PortalAccountRecord } from '../portal/portal.repository';
import type { PortalRepository } from '../portal/portal.repository';

export interface OwnPortalAccount {
  readonly accountId: Id<'Account'>;
  /** Each address the user signs in with, masked; `null` once erased. */
  readonly contacts: readonly { readonly method: PortalMethod; readonly masked: string | null }[];
}

/**
 * The portal's "my account" (ADR-0026): the signed-in portal user's addresses, masked.
 * `own-resources`, by the actor's id; a staff account answers not found.
 */
export class ViewOwnPortalAccount extends UseCase<void, OwnPortalAccount, AccountNotFound> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.view-own-portal-account',
    rule: { kind: 'own-resources' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly portal: PortalRepository,
    private readonly subjectKeys: SubjectKeyService,
  ) {
    super(gate);
  }

  protected async handle(context: CallContext): Promise<Result<OwnPortalAccount, AccountNotFound>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated' || actor.population !== 'portal-user') {
      return err(ACCOUNT_NOT_FOUND);
    }
    const read = await this.unitOfWork.run<
      { account: PortalAccountRecord; keys: ReadonlyMap<string, Uint8Array | null> },
      AccountNotFound
    >(
      tenant,
      async () => {
        const account = await this.portal.findAccount(tenant, actor.accountId);
        if (account === null) return err(ACCOUNT_NOT_FOUND);
        return ok({
          account,
          keys: await this.subjectKeys.wrappedKeys(tenant, [account.accountId]),
        });
      },
      { readOnly: true },
    );
    if (!read.ok) return read;
    const { account, keys } = read.value;
    // Opened after the unit: decryption is CPU work.
    const contacts = account.contacts.map((contact) => {
      const plain = this.subjectKeys.open(
        tenant,
        account.accountId,
        keys.get(account.accountId),
        contact.sealed,
      );
      return {
        method: contact.kind,
        masked: plain === null ? null : maskAddress(contact.kind, plain.toString('utf8')),
      };
    });
    return ok({ accountId: account.accountId, contacts });
  }
}
