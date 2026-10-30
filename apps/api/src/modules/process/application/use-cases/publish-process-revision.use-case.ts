import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { PROCESS_DEFINITIONS_PUBLISH } from '../../contracts/permissions';
import { PROCESS_REVISION_PUBLISHED } from '../../domain/audit-actions';
import { checkBpmn, type FormReference } from '../../domain/bpmn-guard';
import { attributesOf } from '../../domain/task-settings';
import { MAX_FORM_REFERENCES, type FormReferences } from '../../../forms';
import type { EngineCommands } from '../engine-commands';
import type {
  BpmnRefusal,
  DecisionNotFound,
  FormNotFound,
  FormStartsAnotherProcess,
  StartFormChanged,
} from '../failures';
import type { BridgeHashing } from '../ports/bridge-hashing';
import type { FormBinding, ProcessRepository } from '../process.repository';

type PublishFailure =
  BpmnRefusal | DecisionNotFound | FormNotFound | FormStartsAnotherProcess | StartFormChanged;

export interface PublishProcessRevisionInput {
  /** The BPMN process id of the model. */
  readonly processKey: string;
  readonly bpmnXml: string;
}

export interface PublishedRevision {
  readonly id: Id<'ProcessRevision'>;
  readonly revision: number;
}

/**
 * Publishes a BPMN model as the next immutable revision of its process (ADR-0007 V1) and queues
 * its deployment to the engine under the tenant (ADR-0020 decision 6). Publishing is its own
 * permission, apart from designing (owner decision D7). Only plain BPMN passes the intake check:
 * the engine is shared by every tenant.
 */
export class PublishProcessRevision extends UseCase<
  PublishProcessRevisionInput,
  PublishedRevision,
  PublishFailure
> {
  static override readonly access: AccessDeclaration = {
    name: 'process.publish-process-revision',
    rule: { kind: 'permissions', allOf: [PROCESS_DEFINITIONS_PUBLISH.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly commands: EngineCommands,
    private readonly hashing: BridgeHashing,
    private readonly audit: AuditWriter,
    private readonly forms: FormReferences,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: PublishProcessRevisionInput,
  ): Promise<Result<PublishedRevision, PublishFailure>> {
    const checked = checkBpmn(input.bpmnXml, input.processKey);
    if (!checked.ok) return checked;
    // The forms the model names, pinned to their published revisions (slice 2.6), read through
    // the forms facade as the publisher, before the unit.
    const pinned = await this.pinForms(context, checked.value.forms);
    if (!pinned.ok) return pinned;
    const bindings = pinned.value;
    const start = bindings.find((binding) => binding.kind === 'start');
    const contentHash = this.hashing.contentHash(input.bpmnXml);
    // The core's settings of each user task (ADR-0025), applied when the sync sees the task.
    const taskSettings = Object.fromEntries(
      [...checked.value.userTasks].map(([taskKey, settings]) => [taskKey, attributesOf(settings)]),
    );
    const id = this.ids.next<'ProcessRevision'>();
    const { tenant } = context;

    return this.unitOfWork.run<PublishedRevision, PublishFailure>(tenant, async () => {
      // Two publishes of one key at once: the unique (tenant, key, revision) makes the second a
      // stale write (409 conflict.stale, the repository), and the caller tries again.
      const revision = (await this.repository.latestRevisionNumber(tenant, input.processKey)) + 1;
      await this.repository.insertRevision(
        tenant,
        {
          id,
          processKey: input.processKey,
          revision,
          bpmnXml: input.bpmnXml,
          contentHash,
          taskSettings,
        },
        this.clock.now(),
      );
      await this.repository.insertFormBindings(tenant, id, bindings);
      // Each decision task names a table the tenant published (slice 2.7): the engine runs its
      // latest revision when the step runs, and the deployment carries it.
      const decisions = checked.value.decisions;
      const published = new Set(
        (
          await this.repository.latestDecisions(tenant, [
            ...new Set(decisions.map((decision) => decision.decisionKey)),
          ])
        ).map((decision) => decision.decisionKey),
      );
      const missing = decisions.find((decision) => !published.has(decision.decisionKey));
      if (missing !== undefined) {
        return err({ code: 'process.decision.not-found', field: missing.elementId });
      }
      // A key keeps the start form it claimed: without it, submissions would start nothing.
      const claimed = await this.repository.startFormOf(tenant, input.processKey);
      if (claimed !== null && claimed !== start?.formId) {
        return err({
          code: 'process.form.start-form-changed',
          field: start?.elementId ?? 'formKey',
        });
      }
      if (start !== undefined && claimed === null) {
        const holder = await this.repository.claimStartForm(
          tenant,
          start.formId,
          input.processKey,
          this.clock.now(),
        );
        if (holder !== input.processKey) {
          return err({ code: 'process.form.starts-another-process', field: start.elementId });
        }
      }
      await this.commands.deployRevision(context, { id });
      await this.audit.record(
        context,
        PROCESS_REVISION_PUBLISHED.entry(id, { after: { revision } }),
      );
      return ok({ id, revision });
    });
  }

  /** Every form reference of the model as a binding, or the first element whose form is unknown. */
  private async pinForms(
    context: CallContext,
    references: readonly FormReference[],
  ): Promise<Result<FormBinding[], BpmnRefusal | FormNotFound>> {
    if (references.length === 0) return ok([]);
    const keys = [...new Set(references.map((reference) => reference.formKey))];
    if (keys.length > MAX_FORM_REFERENCES) {
      return err({ code: 'process.bpmn.forbidden-construct', field: 'formKey' });
    }
    // The start form routes every submission of it: the facade answers it only to a publisher
    // of that form.
    const startKey = references.find((reference) => reference.kind === 'start')?.formKey;
    const resolved = await this.forms.published(context, keys, startKey);
    const byKey = new Map(resolved.ok ? resolved.value.map((form) => [form.key, form]) : []);
    const bindings: FormBinding[] = [];
    for (const reference of references) {
      const form = byKey.get(reference.formKey);
      if (form === undefined)
        return err({ code: 'process.form.not-found', field: reference.elementId });
      bindings.push({
        elementId: reference.elementId,
        kind: reference.kind,
        formId: form.formId,
        formRevisionId: form.revisionId,
      });
    }
    return ok(bindings);
  }
}
