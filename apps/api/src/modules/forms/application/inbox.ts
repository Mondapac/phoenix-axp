import type { CallContext, Id, Temporal } from '@phoenix/shared-kernel';
import { FieldPolicy, isVisible, type FieldAccess } from '../../../platform/authz';
import type { SubjectKeyService } from '../../../platform/subject-keys';
import type { FormField } from '../domain/form-fields';
import type { SubmissionChannel, SubmissionStatus } from '../domain/submission';
import { answersFromBytes } from './answers';
import type { FormRecord, RevisionFields } from './form.repository';
import { descriptorsOf, type SubmissionAccess } from './submission-access';
import type { SubmissionRecord } from './submission.repository';

/** A submission as the form inbox shows it: only the answers the reader's field modes show. */
export interface SubmissionView {
  readonly id: Id<'FormSubmission'>;
  readonly formId: Id<'Form'>;
  readonly revisionId: Id<'FormRevision'>;
  readonly revisionNumber: number;
  readonly channel: SubmissionChannel;
  readonly status: SubmissionStatus;
  readonly submittedAt: Temporal.Instant;
  /** True once the personal data was erased: `answers` is then empty. */
  readonly erased: boolean;
  /** By field id; hidden fields are left out (ADR-0024 decision 6). */
  readonly answers: Readonly<Record<string, unknown>>;
  /** For erasing it on request: the version the reader saw (`409 conflict.stale` otherwise). */
  readonly version: number;
}

/** A visible field's id and its name in the revision the answer was written under. */
export interface VisibleField {
  readonly id: Id<'Field'>;
  readonly name: string;
}

/**
 * The field access of the reader for each revision the submissions were written under: one
 * evaluation per revision (ADR-0024 decision 5), each against that revision's fields and the
 * form's current ones. Before the unit that reads the answers.
 */
export async function accessByRevision(
  access: SubmissionAccess,
  context: CallContext,
  form: FormRecord,
  revisions: ReadonlyMap<string, RevisionFields>,
  current: readonly FormField[] | null,
): Promise<Map<string, FieldAccess>> {
  const byRevision = new Map<string, FieldAccess>();
  for (const [id, revision] of revisions) {
    byRevision.set(
      id,
      await access.forRead(context, form, descriptorsOf(revision.fields ?? [], current)),
    );
  }
  return byRevision;
}

/**
 * The views of `records`, decrypted after the unit that read them with their wrapped keys,
 * and projected through FieldPolicy: a submission whose revision the reader cannot read is
 * left out, and so is every field not visible.
 */
export function viewsOf(
  context: CallContext,
  subjectKeys: SubjectKeyService,
  records: readonly SubmissionRecord[],
  wrappedKeys: ReadonlyMap<string, Uint8Array | null>,
  revisions: ReadonlyMap<string, RevisionFields>,
  access: ReadonlyMap<string, FieldAccess>,
): { views: SubmissionView[]; fields: VisibleField[] } {
  const views: SubmissionView[] = [];
  const fields = new Map<string, VisibleField>();
  for (const record of records) {
    const reader = access.get(record.revisionId);
    const revision = revisions.get(record.revisionId);
    if (reader === undefined || revision === undefined || !reader.canRead) continue;
    const plain =
      record.erasedAt === null
        ? subjectKeys.open(context.tenant, record.id, wrappedKeys.get(record.id), record.data)
        : null;
    const answers = plain === null ? {} : FieldPolicy.project(answersFromBytes(plain), reader);
    for (const field of revision.fields ?? []) {
      if (isVisible(reader.readModes.get(field.id)) && !fields.has(field.id)) {
        fields.set(field.id, { id: field.id, name: field.name });
      }
    }
    views.push({
      id: record.id,
      formId: record.formId,
      revisionId: record.revisionId,
      revisionNumber: revision.number,
      channel: record.channel,
      status: record.status,
      submittedAt: record.submittedAt,
      erased: plain === null,
      answers,
      version: record.version,
    });
  }
  return { views, fields: [...fields.values()] };
}
