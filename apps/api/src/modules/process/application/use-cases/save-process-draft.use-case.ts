import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Clock, Id, IdGenerator, Result } from '@phoenix/shared-kernel';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { StaleAggregateError } from '../../../../platform/unit-of-work/errors';
import { PROCESS_DEFINITIONS_DESIGN } from '../../contracts/permissions';
import { PROCESS_DRAFT_SAVED } from '../../domain/audit-actions';
import { checkBpmn } from '../../domain/bpmn-guard';
import type { BpmnRefusal } from '../failures';
import type { ProcessRepository } from '../process.repository';

export interface SaveProcessDraftInput {
  /** The BPMN process id of the model. */
  readonly processKey: string;
  readonly bpmnXml: string;
  /** The draft version read; 0 for the first draft of the key. */
  readonly version: number;
}

/** What a draft cannot be stored with at all: not a model of this key. */
type DraftRefusal = Extract<
  BpmnRefusal,
  {
    code: 'process.bpmn.too-large' | 'process.bpmn.malformed' | 'process.bpmn.process-key-mismatch';
  }
>;
const REFUSED: ReadonlySet<string> = new Set<DraftRefusal['code']>([
  'process.bpmn.too-large',
  'process.bpmn.malformed',
  'process.bpmn.process-key-mismatch',
]);

export interface SavedDraft {
  readonly version: number;
  /** Why publishing this draft would be refused now, or null: a draft may be unfinished. */
  readonly problem: BpmnRefusal | null;
}

/**
 * Saves the working copy of a process key in the modeler (slice 2.10; designing is its own
 * permission, apart from publishing: owner decision D7). The draft is the tenant's own model,
 * never deployed: it may still fail the intake check that publishing runs, and the answer says
 * why. Only a model that is not one of this key, or is too large, is refused. A stale version
 * is 409 `conflict.stale`.
 */
export class SaveProcessDraft extends UseCase<SaveProcessDraftInput, SavedDraft, DraftRefusal> {
  static override readonly access: AccessDeclaration = {
    name: 'process.save-process-draft',
    rule: { kind: 'permissions', allOf: [PROCESS_DEFINITIONS_DESIGN.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ProcessRepository,
    private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: SaveProcessDraftInput,
  ): Promise<Result<SavedDraft, DraftRefusal>> {
    const checked = checkBpmn(input.bpmnXml, input.processKey);
    if (!checked.ok && REFUSED.has(checked.error.code)) {
      return err(checked.error as DraftRefusal);
    }
    const problem = checked.ok ? null : checked.error;
    const { tenant } = context;
    return this.unitOfWork.run<SavedDraft, never>(tenant, async () => {
      const existing = await this.repository.findDraft(tenant, input.processKey);
      const id: Id<'ProcessDraft'> = existing?.id ?? this.ids.next<'ProcessDraft'>();
      const saved = await this.repository.saveDraft(
        tenant,
        { id, processKey: input.processKey, bpmnXml: input.bpmnXml },
        input.version,
        this.clock.now(),
      );
      if (!saved) throw new StaleAggregateError('ProcessDraft', id);
      const version = input.version + 1;
      await this.audit.record(context, PROCESS_DRAFT_SAVED.entry(id, { after: { version } }));
      return ok({ version, problem });
    });
  }
}
