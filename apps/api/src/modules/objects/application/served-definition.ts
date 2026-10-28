import { ok } from '@phoenix/shared-kernel';
import type { TenantContext } from '@phoenix/shared-kernel';
import type { UnitOfWork } from '../../../platform/unit-of-work/unit-of-work';
import {
  OBJECTS_RECORD_CREATE,
  OBJECTS_RECORD_DELETE,
  OBJECTS_RECORD_READ,
  OBJECTS_RECORD_UPDATE,
} from '../contracts/permissions';
import type {
  DefinitionRecord,
  DefinitionRepository,
  RevisionRecord,
} from './definition.repository';

/** The operation keys of each record path, for `RecordAccess.at` (ADR-0024 decision 2). */
export const READ_OPERATIONS = { read: OBJECTS_RECORD_READ.key, write: OBJECTS_RECORD_UPDATE.key };
export const CREATE_OPERATIONS = {
  read: OBJECTS_RECORD_READ.key,
  write: OBJECTS_RECORD_CREATE.key,
};
export const UPDATE_OPERATIONS = READ_OPERATIONS;
export const DELETE_OPERATIONS = {
  read: OBJECTS_RECORD_READ.key,
  write: OBJECTS_RECORD_DELETE.key,
};

/** A definition that serves records, and the revision it publishes. */
export interface ServedDefinition {
  readonly definition: DefinitionRecord;
  readonly current: RevisionRecord;
}

/**
 * The definition of `key` with its published revision, read in a unit of its own; null for an
 * unknown key or a draft (a draft serves no record). A retired definition is returned: reads
 * and deletes still work, writes check `status`.
 */
export async function servedDefinition(
  unitOfWork: UnitOfWork,
  definitions: DefinitionRepository,
  tenant: TenantContext,
  key: string,
): Promise<ServedDefinition | null> {
  const read = await unitOfWork.run(
    tenant,
    async () => {
      const definition = await definitions.findByKey(tenant, key);
      if (definition === null || definition.publishedRevisionId === null) return ok(null);
      const current = await definitions.findRevision(tenant, definition.publishedRevisionId);
      return ok(current === null ? null : { definition, current });
    },
    { readOnly: true },
  );
  return read.ok ? read.value : null;
}
