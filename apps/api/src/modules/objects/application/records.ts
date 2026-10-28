import type { CallContext, Id, TenantContext } from '@phoenix/shared-kernel';
import { FieldPolicy, type FieldAccess } from '../../../platform/authz';
import type { SubjectKeyService } from '../../../platform/subject-keys';
import type { ObjectField } from '../domain/fields';
import {
  valuesFromJson,
  valuesToJson,
  type RecordValues,
  type StoredValue,
} from '../domain/record-values';
import type { RevisionRecord } from './definition.repository';
import type { StoredRecord } from './record.repository';

// Sealing, opening and showing records (ADR-0017 decision 4). The values of the fields the
// revision marks sensitive are sealed under the record's subject key; the others are plain.

/** The subject-key module name of the objects module. */
export const SUBJECT_KEY_MODULE = 'objects';

/** A record as a reader sees it: the values its field modes show, by API key. */
export interface RecordView {
  readonly id: Id<'ObjectRecord'>;
  readonly siteId: Id<'Site'>;
  /** The number of the revision the record was last written under. */
  readonly revisionNumber: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly values: Readonly<Record<string, StoredValue>>;
}

/** The values split by where they are stored: plain, or sealed under the subject key. */
export function splitValues(
  fields: readonly ObjectField[],
  values: RecordValues,
): { readonly plain: RecordValues; readonly sensitive: RecordValues } {
  const sensitiveIds = new Set(fields.filter((f) => f.sensitive).map((f) => f.id as string));
  const plain = new Map<Id<'Field'>, StoredValue>();
  const sensitive = new Map<Id<'Field'>, StoredValue>();
  for (const [id, value] of values) (sensitiveIds.has(id) ? sensitive : plain).set(id, value);
  return { plain, sensitive };
}

/** The bytes sealed for the sensitive values: canonical JSON by field id. */
export const sealedText = (sensitive: RecordValues): Buffer =>
  Buffer.from(JSON.stringify(valuesToJson(sensitive)), 'utf8');

/**
 * Every value of a stored record: the plain ones and the opened sealed ones. A key that cannot
 * be read throws (never answered as empty); a destroyed key cannot happen for a stored record,
 * whose key is destroyed only with its row.
 */
export function openValues(
  subjectKeys: SubjectKeyService,
  tenant: TenantContext,
  record: StoredRecord,
  wrappedKey: Uint8Array | null | undefined,
): Map<Id<'Field'>, StoredValue> {
  const plaintext = subjectKeys.open(tenant, record.id, wrappedKey, record.sealed);
  if (plaintext === null) throw new Error(`objects: the subject key of ${record.id} is missing`);
  const values = new Map(record.values);
  for (const [id, value] of valuesFromJson(JSON.parse(plaintext.toString('utf8')))) {
    values.set(id, value);
  }
  return values;
}

/**
 * The record as `access` shows it, through `FieldPolicy.project` only (ADR-0024 decision 11):
 * hidden fields are left out, and values are named by the API keys of the revision the record
 * was written under.
 */
export function viewOf(
  record: StoredRecord,
  revision: RevisionRecord,
  values: RecordValues,
  access: Pick<FieldAccess, 'canRead' | 'readModes'>,
): RecordView {
  const shown = FieldPolicy.project(Object.fromEntries(values), access);
  const named: Record<string, StoredValue> = {};
  for (const field of revision.fields) {
    const value = shown[field.id];
    if (value !== undefined) named[field.key] = value as StoredValue;
  }
  return {
    id: record.id,
    siteId: record.siteId,
    revisionNumber: revision.number,
    version: record.version,
    createdAt: record.createdAt.toString(),
    updatedAt: record.updatedAt.toString(),
    values: named,
  };
}

/** Reads the subject keys of `records` inside the caller's unit. */
export function keysOf(
  subjectKeys: SubjectKeyService,
  context: CallContext,
  records: readonly StoredRecord[],
): Promise<ReadonlyMap<string, Uint8Array | null>> {
  return subjectKeys.wrappedKeys(
    context.tenant,
    records.map((record) => record.id),
  );
}
