import { encodePayload, err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { requestSubmitted } from '../../domain/events';
import type {
  ApprovalSettings,
  ApproverDirectory,
  ContentHasher,
  FormValidator,
} from '../ports/collaborators';
import type { ProcessStore } from '../ports/process-store';

export interface SubmitRequestInput {
  readonly formKey: string;
  readonly processKey: string;
  readonly answers: unknown;
}

export type SubmitRequestError =
  | { readonly code: 'request.forbidden' }
  | { readonly code: 'form.not-published' }
  | { readonly code: 'request.invalid'; readonly fields: readonly string[] }
  | { readonly code: 'request.no-approver' };

const NO_PERMISSION_KEYS = { isKnownPermissionKey: () => false };

/**
 * Submits a JSON Schema form and asks the engine to start its process (ADR-0005, ADR-0007).
 * The request row (V3: form revision, process revision, content hash) and the outbox command
 * commit in one transaction; nothing talks to the engine here. The relay starts the instance
 * later with the request id as its business key.
 *
 * Access (spike; `platform/authz` is deferred): any authenticated actor of the tenant.
 */
export class SubmitRequest {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly store: ProcessStore,
    private readonly validator: FormValidator,
    private readonly hasher: ContentHasher,
    private readonly directory: ApproverDirectory,
    private readonly settings: ApprovalSettings,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(
    context: CallContext,
    input: SubmitRequestInput,
  ): Promise<Result<{ readonly requestId: Id<'Request'> }, SubmitRequestError>> {
    const { actor, tenant } = context;
    if (actor.kind !== 'authenticated') return err({ code: 'request.forbidden' });

    const published = await this.unitOfWork.run(
      tenant,
      async () => {
        const form = await this.store.latestFormRevision(tenant, input.formKey);
        const process = await this.store.latestProcessRevision(tenant, input.processKey);
        return ok(form && process ? { form, process } : null);
      },
      { readOnly: true },
    );
    if (!published.ok || published.value === null) return err({ code: 'form.not-published' });
    const { form, process } = published.value;

    const invalid = this.validator.invalidFields(form.jsonSchema, input.answers);
    if (invalid.length > 0) return err({ code: 'request.invalid', fields: invalid });
    const approvers = await this.directory.approversOf(context, actor.accountId);
    if (approvers === null) return err({ code: 'request.no-approver' });

    // Slow and external work before the unit (CLAUDE.md, persistence).
    const requestId = this.ids.next<'Request'>();
    const contentHash = this.hasher.hashOf({
      formRevisionId: form.id,
      processRevisionId: process.id,
      answers: input.answers,
    });
    const now = this.clock.now();
    const event = requestSubmitted.record({
      aggregateId: requestId,
      aggregateVersion: 1,
      occurredAt: now,
      payload: {
        requestId,
        processRevisionId: process.id,
        approverId: approvers.approverId as Id,
        managerId: approvers.managerId as Id,
        escalateAfterSeconds: this.settings.escalateAfterSeconds(tenant),
      },
    });
    const payload = encodePayload(requestSubmitted.fields, event.payload, NO_PERMISSION_KEYS);
    if (!payload.ok) throw new Error('process.request-submitted.v1: payload refused');

    return this.unitOfWork.run(tenant, async () => {
      await this.store.insertRequest(tenant, {
        id: requestId,
        requesterId: actor.accountId,
        formRevisionId: form.id,
        processRevisionId: process.id,
        answers: input.answers as object,
        contentHash,
        status: 'submitted',
        processInstanceId: null,
        submittedAt: now,
        version: 1,
      });
      await this.store.appendOutbox(tenant, {
        eventId: this.ids.next<'event'>(),
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: requestId,
        aggregateVersion: 1,
        occurredAt: now,
        correlationId: context.correlationId,
        payload: payload.value,
      });
      return ok({ requestId });
    });
  }
}
