import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, ApiResponse } from '@nestjs/swagger';
import { FIELD_TYPES, MAX_FIELDS, MAX_OPTIONS, PORTAL_MODES } from '../domain/fields';
import { DEFINITION_STATUSES } from '../domain/lifecycle';

// The OpenAPI shapes of the objects API. They document only: requests are parsed by the zod
// schemas of the controllers and answers come from the use cases, so a change there is
// mirrored here (test/objects.e2e.spec.ts checks every objects operation is described).

const ID = { format: 'uuid', example: '01890a5d-ac96-774b-bcce-b302099a8057' } as const;
const VERSION = { type: 'integer', minimum: 1, example: 1 } as const;
const KEY = { maxLength: 256, example: 'contracts', description: 'A lowercase slug.' } as const;
const INSTANT = { format: 'date-time', example: '2026-10-30T12:00:00Z' } as const;

/** A record's values by field API key: text, decimal, date and choice values are strings. */
const RECORD_VALUES = {
  type: 'object' as const,
  additionalProperties: {
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    nullable: true,
  },
  example: { title: 'قرارداد ۱', amount: '1200.5' },
};

/** The error body of every refusal (platform-foundations 5.1). */
export class ErrorBody {
  @ApiProperty({ type: 'integer', example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'objects.definition.not-found' })
  code!: string;

  @ApiPropertyOptional({ description: 'The request or field path of an invalid value.' })
  field?: string;
}

const REFUSALS: Readonly<Record<number, string>> = {
  400: 'Malformed request (`request.invalid`) or an invalid value (`objects.value.invalid`)',
  401: 'Not signed in (`access.unauthenticated`)',
  403: 'Missing permission (`access.denied`) or a field that is not editable (`access.field-denied`)',
  404: 'Unknown, or outside the caller’s grants: both answer the same',
  409: 'Another version (`conflict.stale`) or a state that refuses the change',
  422: 'A record that breaks its fields’ rules (`objects.record.invalid`)',
};

/** The refusals an operation can answer, each with the error body. */
export const ApiRefusals = (...statuses: (keyof typeof REFUSALS)[]) =>
  applyDecorators(
    ApiExtraModels(ErrorBody),
    ...statuses.map((status) =>
      ApiResponse({ status, description: REFUSALS[status], type: ErrorBody }),
    ),
  );

// Definitions (studio API).

export class DefinitionBody {
  @ApiProperty(ID)
  id!: string;

  @ApiProperty({ ...ID, description: 'The owning site.' })
  siteId!: string;

  @ApiProperty(KEY)
  key!: string;

  @ApiProperty({ example: 'قراردادها' })
  name!: string;

  @ApiProperty({ enum: DEFINITION_STATUSES })
  status!: string;

  @ApiProperty({ ...ID, nullable: true, type: String })
  publishedRevisionId!: string | null;

  @ApiProperty({ type: 'integer', description: 'The newest revision; 0 before the first.' })
  latestRevisionNumber!: number;

  @ApiProperty(VERSION)
  version!: number;
}

export class DefinitionListBody {
  @ApiProperty({ type: [DefinitionBody] })
  items!: DefinitionBody[];
}

export class RevisionSummaryBody {
  @ApiProperty(ID)
  id!: string;

  @ApiProperty(ID)
  definitionId!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  number!: number;

  @ApiProperty({
    example: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  contentHash!: string;

  @ApiProperty(INSTANT)
  createdAt!: string;
}

export class DefinitionDetailBody {
  @ApiProperty({ type: DefinitionBody })
  definition!: DefinitionBody;

  @ApiProperty({ type: [RevisionSummaryBody], description: 'Newest first.' })
  revisions!: RevisionSummaryBody[];
}

export class ChoiceOptionBody {
  @ApiProperty(KEY)
  key!: string;

  @ApiProperty({ maxLength: 1024 })
  label!: string;
}

export class FieldBody {
  @ApiProperty({ ...ID, description: 'Stable across revisions and renames.' })
  id!: string;

  @ApiProperty({ ...KEY, example: 'title', description: 'The field’s name in the generated API.' })
  key!: string;

  @ApiProperty({ example: 'عنوان' })
  label!: string;

  @ApiProperty({ enum: FIELD_TYPES })
  type!: string;

  @ApiProperty()
  required!: boolean;

  @ApiProperty({ description: 'Hidden until a field rule opens it, and sealed at rest.' })
  sensitive!: boolean;

  @ApiPropertyOptional({ enum: ['read', 'edit'] })
  portal?: string;

  @ApiPropertyOptional({ type: [ChoiceOptionBody], description: '`choice` only.' })
  options?: ChoiceOptionBody[];

  @ApiPropertyOptional({ type: 'integer', description: '`text` and `long-text` only.' })
  maxLength?: number;
}

export class RevisionBody extends RevisionSummaryBody {
  @ApiProperty({ type: [FieldBody] })
  fields!: FieldBody[];
}

export class SavedRevisionBody {
  @ApiProperty(ID)
  id!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  number!: number;

  @ApiProperty()
  contentHash!: string;

  @ApiProperty({ type: [FieldBody] })
  fields!: FieldBody[];
}

export class CreatedIdBody {
  @ApiProperty(ID)
  id!: string;
}

export class CreateDefinitionRequest {
  @ApiProperty(ID)
  siteId!: string;

  @ApiProperty(KEY)
  key!: string;

  @ApiProperty({ maxLength: 1024, example: 'قراردادها' })
  name!: string;
}

export class RenameDefinitionRequest {
  @ApiProperty(VERSION)
  version!: number;

  @ApiProperty({ maxLength: 1024 })
  name!: string;
}

export class FieldRequest {
  @ApiPropertyOptional({ ...ID, description: 'The id of a field kept from an earlier revision.' })
  id?: string;

  @ApiProperty({ ...KEY, example: 'title' })
  key!: string;

  @ApiProperty({ maxLength: 1024 })
  label!: string;

  @ApiProperty({ enum: FIELD_TYPES, description: 'A kept field cannot change type.' })
  type!: string;

  @ApiPropertyOptional({ default: false })
  required?: boolean;

  @ApiPropertyOptional({
    description: 'True when a field first appears unless set; lowering it needs a protected key.',
  })
  sensitive?: boolean;

  @ApiPropertyOptional({ enum: PORTAL_MODES })
  portal?: string;

  @ApiPropertyOptional({ type: [ChoiceOptionBody], maxItems: MAX_OPTIONS })
  options?: ChoiceOptionBody[];

  @ApiPropertyOptional({ type: 'integer' })
  maxLength?: number;
}

export class SaveRevisionRequest {
  @ApiProperty({ type: [FieldRequest], maxItems: MAX_FIELDS })
  fields!: FieldRequest[];
}

export class PublishDefinitionRequest {
  @ApiProperty(VERSION)
  version!: number;

  @ApiProperty(ID)
  revisionId!: string;
}

export class RetireDefinitionRequest {
  @ApiProperty(VERSION)
  version!: number;
}

// Records (the generated API of every Object).

export class DescribedFieldBody {
  @ApiProperty({ ...KEY, example: 'title' })
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ enum: FIELD_TYPES })
  type!: string;

  @ApiProperty()
  required!: boolean;

  @ApiPropertyOptional({ type: [ChoiceOptionBody] })
  options?: ChoiceOptionBody[];

  @ApiPropertyOptional({ type: 'integer' })
  maxLength?: number;

  @ApiProperty({ description: 'The caller may read it at this site.' })
  read!: boolean;

  @ApiProperty({ description: 'The caller may set it when creating a record at this site.' })
  create!: boolean;

  @ApiProperty({ description: 'The caller may change it on a record at this site.' })
  update!: boolean;
}

export class ObjectDescriptionBody {
  @ApiProperty(KEY)
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['published', 'retired'] })
  status!: string;

  @ApiProperty(ID)
  siteId!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  revisionNumber!: number;

  @ApiProperty({
    type: [DescribedFieldBody],
    description: 'Only the fields the caller may read, create or update at this site.',
  })
  fields!: DescribedFieldBody[];
}

export class RecordBody {
  @ApiProperty(ID)
  id!: string;

  @ApiProperty({ ...ID, description: 'The owning site.' })
  siteId!: string;

  @ApiProperty({ type: 'integer', description: 'The revision it was last written under.' })
  revisionNumber!: number;

  @ApiProperty(VERSION)
  version!: number;

  @ApiProperty(INSTANT)
  createdAt!: string;

  @ApiProperty(INSTANT)
  updatedAt!: string;

  @ApiProperty({
    ...RECORD_VALUES,
    description: 'By field key; a field the caller may not read is left out.',
  })
  values!: Record<string, unknown>;
}

export class RecordPageBody {
  @ApiProperty({ type: [RecordBody] })
  items!: RecordBody[];

  @ApiProperty({
    ...ID,
    nullable: true,
    type: String,
    description: 'The `before` of the next page.',
  })
  next!: string | null;
}

export class WrittenRecordBody {
  @ApiProperty(ID)
  id!: string;

  @ApiProperty(VERSION)
  version!: number;
}

export class CreateRecordRequest {
  @ApiPropertyOptional({
    ...ID,
    description:
      'The owning site: the definition’s site or one below it; the definition’s site when absent.',
  })
  siteId?: string;

  @ApiProperty({
    ...RECORD_VALUES,
    maxProperties: MAX_FIELDS,
    description: 'By field key; naming a field the caller may not edit is refused.',
  })
  values!: Record<string, unknown>;
}

export class UpdateRecordRequest {
  @ApiProperty({ ...VERSION, description: 'The version the change was built on.' })
  version!: number;

  @ApiProperty({
    ...RECORD_VALUES,
    maxProperties: MAX_FIELDS,
    description: 'The fields to change, at least one; `null` clears a field.',
  })
  values!: Record<string, unknown>;
}

// GraphQL.

export class GraphqlRequestBody {
  @ApiProperty({
    maxLength: 20000,
    example: '{ records(limit: 10) { items { id values { title } } next } }',
  })
  query!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  variables?: Record<string, unknown> | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true, type: String })
  operationName?: string | null;
}

export class GraphqlAnswerBody {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  data?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Each with its code in `extensions.code`: `graphql.invalid`, `graphql.too-complex`, ' +
      '`conflict.stale`, `internal`, or the code of the refusing use case.',
  })
  errors?: Record<string, unknown>[];
}
