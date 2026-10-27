import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { SESSION_ENDED } from '../../domain/audit-actions';
import type { SessionRepository } from '../session.repository';

/**
 * Ends the caller's own session (ADR-0004 decision 2): its row is deleted, so the cookie is
 * refused from the next request. `own-resources`: the session is the actor's, by its ids.
 */
export class SignOut extends UseCase<void, void> {
  static override readonly access: AccessDeclaration = {
    name: 'identity.sign-out',
    rule: { kind: 'own-resources' },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditWriter,
  ) {
    super(gate);
  }

  protected handle(context: CallContext): Promise<Result<void, never>> {
    const { tenant, actor } = context;
    if (actor.kind !== 'authenticated') return Promise.resolve(ok(undefined));
    return this.unitOfWork.run<void, never>(tenant, async () => {
      if (await this.sessions.end(tenant, actor.sessionId, actor.accountId)) {
        await this.audit.record(context, SESSION_ENDED.entry(actor.sessionId, {}));
      }
      return ok(undefined);
    });
  }
}
