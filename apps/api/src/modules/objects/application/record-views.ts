import type { CallContext } from '@phoenix/shared-kernel';
import type { FieldAccess } from '../../../platform/authz';
import type { SubjectKeyService } from '../../../platform/subject-keys';
import type { DefinitionRecord, RevisionRecord } from './definition.repository';
import { descriptorsOf, type RecordAccess } from './record-access';
import type { StoredRecord } from './record.repository';
import { openValues, viewOf, type RecordView } from './records';
import { READ_OPERATIONS } from './served-definition';

/**
 * The views of `records` for the caller: each record's access is resolved for its own site and
 * the revision it was written under (one resolution per pair in this request, nothing cached
 * across requests), and a record the caller may not read is left out.
 */
export async function recordViews(
  access: RecordAccess,
  subjectKeys: SubjectKeyService,
  context: CallContext,
  definition: DefinitionRecord,
  current: RevisionRecord,
  records: readonly StoredRecord[],
  revisions: ReadonlyMap<string, RevisionRecord>,
  keys: ReadonlyMap<string, Uint8Array | null>,
): Promise<RecordView[]> {
  const resolved = new Map<string, FieldAccess>();
  const views: RecordView[] = [];
  for (const record of records) {
    const revision = revisions.get(record.revisionId);
    if (revision === undefined) throw new Error(`objects: revision of ${record.id} is missing`);
    const pair = `${record.siteId}|${revision.id}`;
    let reader = resolved.get(pair);
    if (reader === undefined) {
      reader = await access.at(
        context,
        definition.id,
        record.siteId,
        READ_OPERATIONS,
        descriptorsOf(revision.fields, current.fields),
      );
      resolved.set(pair, reader);
    }
    if (!reader.canRead) continue;
    const values = openValues(subjectKeys, context.tenant, record, keys.get(record.id));
    views.push(viewOf(record, revision, values, reader));
  }
  return views;
}
