import { err, ok } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import {
  isVisible,
  UseCase,
  type AccessDeclaration,
  type UseCaseGate,
} from '../../../../platform/authz';
import type { UnitOfWork } from '../../../../platform/unit-of-work/unit-of-work';
import { OBJECTS_RECORD_READ } from '../../contracts/permissions';
import type { ChoiceOption, FieldType } from '../../domain/fields';
import type { DefinitionRepository } from '../definition.repository';
import { DEFINITION_NOT_FOUND, type DefinitionNotFound } from '../failures';
import { descriptorsOf, type RecordAccess } from '../record-access';
import { CREATE_OPERATIONS, servedDefinition, UPDATE_OPERATIONS } from '../served-definition';

export interface DescribeObjectInput {
  readonly definitionKey: string;
  /** The site the answer is for; the definition's own site when absent. */
  readonly siteId: Id<'Site'> | null;
}

/** A field of the generated API as the caller may use it at one site. */
export interface DescribedField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly options?: readonly ChoiceOption[];
  readonly maxLength?: number;
  readonly read: boolean;
  readonly create: boolean;
  readonly update: boolean;
}

export interface ObjectDescription {
  readonly key: string;
  readonly name: string;
  readonly status: 'published' | 'retired';
  readonly siteId: Id<'Site'>;
  readonly revisionNumber: number;
  readonly fields: readonly DescribedField[];
}

/**
 * The generated API of one Object for the caller (ADR-0017 decision 7): the fields it may read,
 * create or update at a site; a field it can do none of is left out (ADR-0024 decision 6). A
 * caller with no record access at that site gets "not found".
 */
export class DescribeObject extends UseCase<
  DescribeObjectInput,
  ObjectDescription,
  DefinitionNotFound
> {
  static override readonly access: AccessDeclaration = {
    name: 'objects.describe-object',
    rule: { kind: 'permissions', allOf: [OBJECTS_RECORD_READ.key] },
  };

  constructor(
    gate: UseCaseGate,
    private readonly unitOfWork: UnitOfWork,
    private readonly definitions: DefinitionRepository,
    private readonly access: RecordAccess,
  ) {
    super(gate);
  }

  protected async handle(
    context: CallContext,
    input: DescribeObjectInput,
  ): Promise<Result<ObjectDescription, DefinitionNotFound>> {
    const served = await servedDefinition(
      this.unitOfWork,
      this.definitions,
      context.tenant,
      input.definitionKey,
    );
    if (served === null) return err(DEFINITION_NOT_FOUND);
    const { definition, current } = served;
    const siteId = input.siteId ?? definition.siteId;
    if (!(await this.access.inDefinitionTree(context, definition, siteId))) {
      return err(DEFINITION_NOT_FOUND);
    }
    const descriptors = descriptorsOf(current.fields, current.fields);
    const updating = await this.access.at(
      context,
      definition.id,
      siteId,
      UPDATE_OPERATIONS,
      descriptors,
    );
    const creating = await this.access.at(
      context,
      definition.id,
      siteId,
      CREATE_OPERATIONS,
      descriptors,
    );
    if (!updating.canRead) return err(DEFINITION_NOT_FOUND);
    const retired = definition.status !== 'published';
    const fields: DescribedField[] = [];
    for (const field of current.fields) {
      const read = isVisible(updating.readModes.get(field.id));
      const create = !retired && creating.canWrite && creating.writeModes.get(field.id) === 'edit';
      const update = !retired && updating.canWrite && updating.writeModes.get(field.id) === 'edit';
      if (!read && !create && !update) continue;
      fields.push({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        ...(field.options === undefined ? {} : { options: field.options }),
        ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
        read,
        create,
        update,
      });
    }
    return ok({
      key: definition.key,
      name: definition.name,
      status: retired ? 'retired' : 'published',
      siteId,
      revisionNumber: current.number,
      fields,
    });
  }
}
