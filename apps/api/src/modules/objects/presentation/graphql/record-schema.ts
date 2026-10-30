import { parseId } from '@phoenix/shared-kernel';
import type { CallContext, Id, Result } from '@phoenix/shared-kernel';
import {
  GraphQLBoolean,
  GraphQLError,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  type GraphQLFieldConfigMap,
  type GraphQLInputFieldConfigMap,
} from 'graphql';
import type {
  DescribedField,
  ObjectDescription,
} from '../../application/use-cases/describe-object.use-case';
import type { CreateRecord } from '../../application/use-cases/create-record.use-case';
import type { DeleteRecord } from '../../application/use-cases/delete-record.use-case';
import type { ListRecords, RecordList } from '../../application/use-cases/list-records.use-case';
import type { UpdateRecord } from '../../application/use-cases/update-record.use-case';
import type { ViewRecord } from '../../application/use-cases/view-record.use-case';
import type { FieldType } from '../../domain/fields';

// The generated GraphQL of one Object (ADR-0017 decision 8): built per request from the caller's
// description of the Object at one site, so the schema names only fields the caller may read,
// create or update there. Every resolver calls the same record use case as REST, so the gate,
// record-level access and FieldPolicy hold unchanged. Every generated field is nullable, and a
// field FieldPolicy hides on a record resolves to `null` without an error (ADR-0024 decision 6).

/** The record use cases the resolvers call, each through its gate. */
export interface RecordOperations {
  view(context: CallContext, recordId: Id<'ObjectRecord'>): Promise<Result<RecordView, Failure>>;
  list(
    context: CallContext,
    page: {
      readonly siteId: Id<'Site'> | null;
      readonly before: Id<'ObjectRecord'> | null;
      readonly limit: number;
    },
  ): Promise<
    Result<{ readonly items: readonly RecordView[]; readonly next: string | null }, Failure>
  >;
  create(
    context: CallContext,
    input: { readonly siteId: Id<'Site'> | null; readonly values: Record<string, unknown> },
  ): Promise<Result<Written, Failure>>;
  update(
    context: CallContext,
    input: {
      readonly recordId: Id<'ObjectRecord'>;
      readonly version: number;
      readonly values: Record<string, unknown>;
    },
  ): Promise<Result<Written, Failure>>;
  remove(
    context: CallContext,
    input: { readonly recordId: Id<'ObjectRecord'>; readonly version: number },
  ): Promise<Result<unknown, Failure>>;
}

type RecordView = RecordList['items'][number];
type Failure = { readonly code: string; readonly field?: string };
type Written = { readonly id: string; readonly version: number };

/** The record use cases of one Object, by its key, as the resolvers call them. */
export function recordOperationsOf(
  useCases: {
    readonly view: ViewRecord;
    readonly list: ListRecords;
    readonly create: CreateRecord;
    readonly update: UpdateRecord;
    readonly remove: DeleteRecord;
  },
  definitionKey: string,
): RecordOperations {
  return {
    view: (context, recordId) => useCases.view.execute(context, { definitionKey, recordId }),
    list: (context, page) => useCases.list.execute(context, { definitionKey, ...page }),
    create: (context, input) => useCases.create.execute(context, { definitionKey, ...input }),
    update: (context, input) => useCases.update.execute(context, { definitionKey, ...input }),
    remove: (context, input) => useCases.remove.execute(context, { definitionKey, ...input }),
  };
}

const RECORD_NOT_FOUND = 'objects.record.not-found';
const REQUEST_INVALID = 'request.invalid';
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * The GraphQL name of a field key: keys are lowercase slugs, so `-` becomes `_` and a leading
 * digit gets a `_` before it; both keep the mapping one to one.
 */
export function graphqlNameOf(key: string): string {
  const name = key.replace(/-/g, '_');
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

/**
 * An integer of an Object field: any safe integer, wider than GraphQL's 32-bit `Int`. Input
 * passes through as given (a number, or a string with Persian digits), and the use case checks
 * it against the field as for REST.
 */
const Long = new GraphQLScalarType({
  name: 'Long',
  description: 'A whole number up to 2^53 - 1 in size.',
  serialize: (value) => value,
  parseValue: (value) => {
    if (typeof value === 'number' || typeof value === 'string') return value;
    throw new GraphQLError('Long takes a number or a string.');
  },
  parseLiteral: (node) => {
    // As written: the use case refuses an integer past 2^53 - 1 instead of rounding it.
    if (node.kind === Kind.INT) return node.value;
    if (node.kind === Kind.STRING) return node.value;
    throw new GraphQLError('Long takes a number or a string.');
  },
});

const scalarOf = (type: FieldType) => {
  switch (type) {
    case 'integer':
      return Long;
    case 'boolean':
      return GraphQLBoolean;
    // Decimals as canonical strings, dates and instants as ISO strings, choices as option keys.
    case 'text':
    case 'long-text':
    case 'decimal':
    case 'date':
    case 'date-time':
    case 'choice':
      return GraphQLString;
  }
};

/** A failure of a use case as a GraphQL error: its code, and the GraphQL name of its field. */
function failed(failure: Failure, names: ReadonlyMap<string, string>): never {
  const field =
    failure.field === undefined ? undefined : (names.get(failure.field) ?? failure.field);
  throw new GraphQLError(failure.code, {
    extensions: { code: failure.code, ...(field === undefined ? {} : { field }) },
  });
}

const invalid = (field: string): never => {
  throw new GraphQLError(REQUEST_INVALID, { extensions: { code: REQUEST_INVALID, field } });
};

const recordIdOf = (text: string): Id<'ObjectRecord'> => {
  const id = parseId<'ObjectRecord'>(text);
  if (id.ok) return id.value;
  throw new GraphQLError(RECORD_NOT_FOUND, { extensions: { code: RECORD_NOT_FOUND } });
};

const idArgument = <K extends string>(
  text: string | null | undefined,
  field: string,
): Id<K> | null => {
  if (text === undefined || text === null) return null;
  const id = parseId<K>(text);
  return id.ok ? id.value : invalid(field);
};

const positiveVersion = (version: number): number => (version >= 1 ? version : invalid('version'));

/** The schema of `object` for the caller, whose resolvers call `operations` with its context. */
export function recordSchema(
  object: ObjectDescription,
  operations: RecordOperations,
): GraphQLSchema {
  const keyOf = new Map<string, string>(); // GraphQL name -> field key
  const nameOf = new Map<string, string>(); // field key -> GraphQL name
  for (const field of object.fields) {
    const name = graphqlNameOf(field.key);
    keyOf.set(name, field.key);
    nameOf.set(field.key, name);
  }

  const describe = (field: DescribedField): string =>
    field.required ? `${field.label} (required)` : field.label;

  const valueFields: GraphQLFieldConfigMap<RecordView['values'], CallContext> = {};
  for (const field of object.fields) {
    valueFields[nameOf.get(field.key)!] = {
      type: scalarOf(field.type),
      description: describe(field),
      // A field FieldPolicy hides is absent from the view: it resolves to null, without an error.
      resolve: (values) => (Object.hasOwn(values, field.key) ? values[field.key] : null),
    };
  }

  const recordFields: GraphQLFieldConfigMap<RecordView, CallContext> = {
    id: { type: new GraphQLNonNull(GraphQLID) },
    siteId: { type: new GraphQLNonNull(GraphQLID) },
    revisionNumber: { type: new GraphQLNonNull(GraphQLInt) },
    version: { type: new GraphQLNonNull(GraphQLInt) },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
    updatedAt: { type: new GraphQLNonNull(GraphQLString) },
  };
  if (object.fields.length > 0) {
    recordFields.values = {
      type: new GraphQLNonNull(
        new GraphQLObjectType({ name: 'RecordValues', fields: valueFields }),
      ),
    };
  }
  const record = new GraphQLObjectType<RecordView, CallContext>({
    name: 'Record',
    fields: recordFields,
  });
  const page = new GraphQLObjectType({
    name: 'RecordPage',
    fields: {
      items: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(record))) },
      next: { type: GraphQLID },
    },
  });
  const written = new GraphQLObjectType({
    name: 'WrittenRecord',
    fields: {
      id: { type: new GraphQLNonNull(GraphQLID) },
      version: { type: new GraphQLNonNull(GraphQLInt) },
    },
  });

  const query = new GraphQLObjectType<unknown, CallContext>({
    name: 'Query',
    fields: {
      record: {
        type: record,
        args: { id: { type: new GraphQLNonNull(GraphQLID) } },
        resolve: async (_source, args: { id: string }, context) => {
          const result = await operations.view(context, recordIdOf(args.id));
          return result.ok ? result.value : failed(result.error, nameOf);
        },
      },
      records: {
        type: page,
        description: 'Newest first; `before` is the `next` of the previous page.',
        args: {
          site: { type: GraphQLID },
          before: { type: GraphQLID },
          limit: { type: GraphQLInt },
        },
        resolve: async (
          _source,
          args: { site?: string | null; before?: string | null; limit?: number | null },
          context,
        ) => {
          const limit = args.limit ?? DEFAULT_LIMIT;
          if (limit < 1 || limit > MAX_LIMIT) invalid('limit');
          const result = await operations.list(context, {
            siteId: idArgument<'Site'>(args.site, 'site'),
            before: idArgument<'ObjectRecord'>(args.before, 'before'),
            limit,
          });
          return result.ok ? result.value : failed(result.error, nameOf);
        },
      },
    },
  });

  /** Input values by field key; an explicit `null` clears a field on update. */
  const valuesOf = (input: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(input).map(([name, value]) => {
        const key = keyOf.get(name);
        if (key === undefined) throw new Error(`objects: unvalidated input field ${name}`);
        return [key, value];
      }),
    );

  const mutationFields: GraphQLFieldConfigMap<unknown, CallContext> = {
    deleteRecord: {
      type: GraphQLBoolean,
      args: {
        id: { type: new GraphQLNonNull(GraphQLID) },
        version: { type: new GraphQLNonNull(GraphQLInt) },
      },
      resolve: async (_source, args: { id: string; version: number }, context) => {
        const result = await operations.remove(context, {
          recordId: recordIdOf(args.id),
          version: positiveVersion(args.version),
        });
        return result.ok ? true : failed(result.error, nameOf);
      },
    },
  };
  const writable = object.fields.filter((field) => field.create || field.update);
  if (writable.length > 0) {
    const inputFields: GraphQLInputFieldConfigMap = {};
    for (const field of writable) {
      inputFields[nameOf.get(field.key)!] = {
        type: scalarOf(field.type),
        description: describe(field),
      };
    }
    const values = new GraphQLInputObjectType({ name: 'RecordInput', fields: inputFields });
    mutationFields.createRecord = {
      type: written,
      args: { siteId: { type: GraphQLID }, values: { type: new GraphQLNonNull(values) } },
      resolve: async (
        _source,
        args: { siteId?: string | null; values: Record<string, unknown> },
        context,
      ) => {
        const result = await operations.create(context, {
          siteId: idArgument<'Site'>(args.siteId, 'siteId'),
          values: valuesOf(args.values),
        });
        return result.ok ? result.value : failed(result.error, nameOf);
      },
    };
    mutationFields.updateRecord = {
      type: written,
      args: {
        id: { type: new GraphQLNonNull(GraphQLID) },
        version: { type: new GraphQLNonNull(GraphQLInt) },
        values: { type: new GraphQLNonNull(values) },
      },
      resolve: async (
        _source,
        args: { id: string; version: number; values: Record<string, unknown> },
        context,
      ) => {
        const result = await operations.update(context, {
          recordId: recordIdOf(args.id),
          version: positiveVersion(args.version),
          values: valuesOf(args.values),
        });
        return result.ok ? result.value : failed(result.error, nameOf);
      },
    };
  }

  return new GraphQLSchema({
    query,
    mutation: new GraphQLObjectType({ name: 'Mutation', fields: mutationFields }),
  });
}
