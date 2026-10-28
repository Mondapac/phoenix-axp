import { ok } from '@phoenix/shared-kernel';
import type { CallContext, Result } from '@phoenix/shared-kernel';
import { UseCase, type AccessDeclaration, type UseCaseGate } from '../../../../platform/authz';
import type { AuditWriter } from '../../../../platform/audit/audit-writer';
import type { SubjectKeyService } from '../../../../platform/subject-keys';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { RECORD_RESEALED } from '../../domain/audit-actions';
import type { DefinitionRepository, RevisionRecord } from '../definition.repository';
import type { RecordRepository, StoredRecord } from '../record.repository';
import { openSealed, resplitValues, sealedText } from '../records';

/** The records one batch reads; a run takes batches until none lags. */
export const SEAL_BATCH = 100;
/** The most batches one run takes, so a run stays inside the job's time budget. */
export const MAX_SEAL_BATCHES = 50;

/**
 * The seal job's use case (ADR-0017 decision 4, security review of slice 2.8, M2): splits the
 * values of every record whose split lags its definition's published revision under that
 * revision's `sensitive` marks, so a field marked sensitive after records were written is
 * sealed under each record's subject key and leaves the plain column. Values and version do not
 * change. Opening and sealing run between units. Safe to run twice and concurrently: a record
 * written meanwhile is skipped (its writer split it under the published revision).
 */
export class SealRecords extends UseCase<void, { readonly resealed: number }, never> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.seal-records',
    rule: { kind: 'system' },
  };

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
    const published = await this.unitOfWork.run(
      tenant,
      async () => {
        const all = await this.definitions.list(tenant, { siteId: null, status: null });
        const ids = all.flatMap((d) =>
          d.publishedRevisionId === null ? [] : [d.publishedRevisionId],
        );
        return ok([...(await this.definitions.revisions(tenant, ids)).values()]);
      },
      { readOnly: true },
    );
    if (!published.ok) throw new Error('objects: the definitions could not be read');
    let resealed = 0;
    let batches = 0;
    for (const revision of published.value) {
      while (batches < MAX_SEAL_BATCHES) {
        batches += 1;
        const done = await this.#batch(context, revision);
        resealed += done.resealed;
        if (done.read < SEAL_BATCH) break;
      }
    }
    return ok({ resealed });
  }

  async #batch(
    context: CallContext,
    revision: RevisionRecord,
  ): Promise<{ read: number; resealed: number }> {
    const { tenant } = context;
    const read = await this.unitOfWork.run(
      tenant,
      async () => {
        const lagging = await this.records.splitElsewhere(
          tenant,
          revision.definitionId,
          revision.id,
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
    const splits = lagging.map((record: StoredRecord) => {
      const wrappedKey = keys.get(record.id);
      const sealed = openSealed(this.subjectKeys, tenant, record, wrappedKey);
      const { plain, sensitive } = resplitValues(revision.fields, record.values, sealed);
      return {
        record,
        values: plain,
        sealed: this.subjectKeys.reseal(tenant, record.id, wrappedKey, sealedText(sensitive)),
      };
    });
    const written = await this.unitOfWork.run<number, never>(tenant, async () => {
      let count = 0;
      for (const { record, values, sealed } of splits) {
        const stored = await this.records.resplit(tenant, record.id, record.version, {
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
    return { read: lagging.length, resealed: written.value };
  }
}
