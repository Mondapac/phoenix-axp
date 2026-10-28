import { Logger } from '@nestjs/common';
import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { RECORD_RESEALED } from '../../domain/audit-actions';
import type { DefinitionRepository, RevisionRecord } from '../definition.repository';
import type { RecordValues } from '../../domain/record-values';
import type { RecordRepository, StoredRecord } from '../record.repository';
import { openSealed, resplitValues, sealedText } from '../records';

/** The records one batch reads; a run takes batches until none lags. */
export const SEAL_BATCH = 100;
/** The most batches one run takes, so a run stays inside the job's time budget. */
export const MAX_SEAL_BATCHES = 50;
/** The most batches one definition takes in a run, so one backlog never starves the others. */
export const MAX_SEAL_BATCHES_PER_DEFINITION = 10;

/** A published revision and the other revisions of its definition. */
interface SealTarget {
  readonly revision: RevisionRecord;
  readonly others: readonly Id<'ObjectRevision'>[];
}

/**
 * The seal job's use case (ADR-0017 decision 4, security review of slice 2.8, M2): seals the
 * plain values of fields that a definition's published revision marks sensitive in the records
 * split under any other revision (an earlier one, or a later one after a rollback), under each
 * record's subject key. Values, version and the revision written under do not change, and
 * nothing sealed is opened to plain. Opening and sealing run between units. Safe to run twice
 * and concurrently: a batch is dropped when its definition publishes another revision
 * meanwhile, and a record written or split again since it was read is skipped.
 */
export class SealRecords extends UseCase<void, { readonly resealed: number }, never> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.seal-records',
    rule: { kind: 'system' },
  };

  readonly #logger = new Logger('SealRecords');
  /** Where the next run starts in the definitions, so each run begins with another one. */
  #start = 0;

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly records: RecordRepository,
    private readonly subjectKeys: SubjectKeyService,
    private readonly audit: AuditWriter,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
  ): Promise<Result<{ readonly resealed: number }, never>> {
    const { tenant } = context;
    // Without the key-encryption key nothing can be sealed: fail the run, never skip quietly.
    if (!this.subjectKeys.available)
      throw new Error('objects.seal-records: subject keys unavailable');
    const targets = await this.unitOfWork.run(
      tenant,
      async () => {
        const all = await this.definitions.list(tenant, { siteId: null, status: null });
        const published = all
          .filter((d) => d.publishedRevisionId !== null)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const revisions = await this.definitions.revisions(
          tenant,
          published.map((d) => d.publishedRevisionId!),
        );
        const found: SealTarget[] = [];
        for (const definition of published) {
          const revision = revisions.get(definition.publishedRevisionId!);
          if (revision === undefined) continue;
          const others = (await this.definitions.listRevisions(tenant, definition.id))
            .filter((r) => r.id !== revision.id)
            .map((r) => r.id);
          if (others.length > 0) found.push({ revision, others });
        }
        return ok(found);
      },
      { readOnly: true },
    );
    if (!targets.ok) throw new Error('objects: the definitions could not be read');
    let resealed = 0;
    let batches = 0;
    const order = targets.value;
    const start = order.length === 0 ? 0 : this.#start % order.length;
    this.#start += 1;
    for (const target of [...order.slice(start), ...order.slice(0, start)]) {
      let after: Id<'ObjectRecord'> | null = null;
      for (let taken = 0; taken < MAX_SEAL_BATCHES_PER_DEFINITION; taken += 1) {
        if (batches >= MAX_SEAL_BATCHES) return ok({ resealed });
        batches += 1;
        const done = await this.#batch(context, target, after);
        resealed += done.resealed;
        // A record left behind (no key, or written meanwhile) is not read again in this run.
        after = done.last;
        if (done.stale || done.last === null) break;
      }
    }
    return ok({ resealed });
  }

  async #batch(
    context: CallContext,
    { revision, others }: SealTarget,
    after: Id<'ObjectRecord'> | null,
  ): Promise<{ last: Id<'ObjectRecord'> | null; resealed: number; stale: boolean }> {
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const lagging = await this.records.splitUnder(
          tenant,
          revision.definitionId,
          others,
          after,
          SEAL_BATCH,
        );
        const keys = await this.subjectKeys.wrappedKeys(
          tenant,
          lagging.map((record) => record.id),
        );
        return ok({ lagging, keys });
      },
      { readOnly: true },
    );
    if (!read.ok) throw new Error('objects: the records could not be read');
    const { lagging, keys } = read.value;
    const splits: { record: StoredRecord; values: RecordValues; sealed: Buffer }[] = [];
    for (const record of lagging) {
      const wrappedKey = keys.get(record.id);
      try {
        const sealed = openSealed(this.subjectKeys, tenant, record, wrappedKey);
        const { plain, sensitive } = resplitValues(revision.fields, record.values, sealed);
        splits.push({
          record,
          values: plain,
          sealed: this.subjectKeys.reseal(tenant, record.id, wrappedKey, sealedText(sensitive)),
        });
      } catch {
        // A stored record always has a readable key; one without must not stop the others.
        this.#logger.warn({
          msg: 'objects.seal-records.unreadable',
          tenantId: tenant.tenantId,
          recordId: record.id,
          correlationId: context.correlationId,
        });
      }
    }
    const written = await this.unitOfWork.run<number | 'stale', never>(tenant, async () => {
      // Another revision published since the run began: its split is the one to follow, and
      // the next run follows it (QA review of PR #35).
      const definition = await this.definitions.find(tenant, revision.definitionId);
      if (definition?.publishedRevisionId !== revision.id) return ok('stale');
      let count = 0;
      for (const { record, values, sealed } of splits) {
        const stored = await this.records.resplit(tenant, record, {
          values,
          sealed,
          sealedUnderId: revision.id,
        });
        if (!stored) continue;
        count += 1;
        await this.audit.record(
          context,
          RECORD_RESEALED.entry(record.id, {
            before: { revisionId: record.sealedUnderId },
            after: { revisionId: revision.id },
          }),
        );
      }
      return ok(count);
    });
    if (!written.ok) throw new Error('objects: the records could not be resealed');
    const last = lagging.length < SEAL_BATCH ? null : lagging[lagging.length - 1]!.id;
    if (written.value === 'stale') return { last, resealed: 0, stale: true };
    return { last, resealed: written.value, stale: false };
  }
}
