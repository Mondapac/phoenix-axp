import {
  execute,
  getOperationAST,
  GraphQLError,
  Kind,
  NoSchemaIntrospectionCustomRule,
  parse,
  specifiedRules,
  validate,
  type DocumentNode,
  type ExecutionResult,
  type FragmentDefinitionNode,
  type GraphQLFormattedError,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql';
import { z } from 'zod';
import { CONFLICT_CODES } from '../http/conflict-filter';
import { StaleAggregateError, TransactionConflictError } from '../unit-of-work/errors';

// The one GraphQL runtime of the API (ADR-0017 decision 8): a module's presentation layer
// builds a schema whose resolvers call its use cases, and runs a request through here. Every
// request is bounded before it executes: its length and token count when it is parsed, its depth
// and field count once it is valid; introspection is off unless the start says it may be on.

/** The bounds of one GraphQL request. */
export interface GraphqlLimits {
  /** Lexical tokens in the document; the parser stops at this many. */
  readonly maxTokens: number;
  /** Nested selection sets below the operation, fragments expanded. */
  readonly maxDepth: number;
  /** Fields selected, `__typename` included, each fragment counted each time it is spread. */
  readonly maxFields: number;
  /**
   * Fields at the root of a query, each a use case call (aliases count apart): bounds the work
   * one request can start, as a page of records costs one field.
   */
  readonly maxRootFields: number;
  /** Fields at the root of a mutation: one write per request, so no batching (ADR-0017). */
  readonly maxMutationRootFields: number;
  /** Whether `__schema` and `__type` may be queried; never in production. */
  readonly introspection: boolean;
}

export const DEFAULT_GRAPHQL_LIMITS: Omit<GraphqlLimits, 'introspection'> = Object.freeze({
  maxTokens: 2_000,
  maxDepth: 6,
  maxFields: 200,
  maxRootFields: 3,
  maxMutationRootFields: 1,
});

/** The longest document accepted, in characters. */
export const MAX_GRAPHQL_DOCUMENT_LENGTH = 20_000;

/**
 * Introspection is on only in an explicit development or test start: an unset `NODE_ENV`
 * counts as production, as for the placeholder check (ADR-0010 decision 4).
 */
export function introspectionAllowed(config: {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly nodeEnvExplicit: boolean;
}): boolean {
  return config.nodeEnvExplicit && config.nodeEnv !== 'production';
}

/** The JSON body of a GraphQL request (GraphQL over HTTP, POST only, one operation). */
export const graphqlRequestBody = z.strictObject({
  query: z.string().min(1).max(MAX_GRAPHQL_DOCUMENT_LENGTH),
  variables: z.record(z.string(), z.unknown()).nullish(),
  operationName: z.string().max(200).nullish(),
});
export type GraphqlRequest = z.infer<typeof graphqlRequestBody>;

/** The error codes this runner answers with, in `extensions.code`. */
export const GRAPHQL_INVALID = 'graphql.invalid';
export const GRAPHQL_TOO_COMPLEX = 'graphql.too-complex';
export const GRAPHQL_INTERNAL = 'internal';

/** The answer of a request: `data` and errors as GraphQL formats them for the wire. */
export interface GraphqlAnswer {
  readonly data?: Record<string, unknown> | null;
  readonly errors?: readonly GraphQLFormattedError[];
}

/**
 * Runs `request` against the schema `schemaOf` builds, with `contextValue` handed to every
 * resolver. The document is parsed and its size checked before `schemaOf` is called, so a
 * refused document costs no schema work (and no database read behind it). A resolver
 * answers an expected failure by throwing a `GraphQLError` with `extensions.code`; any other
 * error is masked as `internal` and passed to `report`, so no exception text reaches the caller.
 */
export async function runGraphql(
  schemaOf: () => GraphQLSchema | Promise<GraphQLSchema>,
  request: GraphqlRequest,
  contextValue: unknown,
  limits: GraphqlLimits,
  report: (error: unknown) => void,
): Promise<GraphqlAnswer> {
  let document: DocumentNode;
  try {
    document = parse(request.query, { maxTokens: limits.maxTokens, noLocation: true });
  } catch (error) {
    if (error instanceof GraphQLError) return refused(GRAPHQL_INVALID, error.message);
    throw error;
  }
  const operation = getOperationAST(document, request.operationName ?? undefined);
  if (operation === null || operation === undefined) {
    return refused(GRAPHQL_INVALID, 'Name the operation to run.');
  }
  if (operation.operation === 'subscription') {
    return refused(GRAPHQL_INVALID, 'Subscriptions are not served.');
  }
  const tooComplex = complexityOf(document, operation, limits);
  if (tooComplex !== null) return refused(GRAPHQL_TOO_COMPLEX, tooComplex);
  const schema = await schemaOf();
  const rules = limits.introspection
    ? specifiedRules
    : [...specifiedRules, NoSchemaIntrospectionCustomRule];
  const invalid = validate(schema, document, rules, { maxErrors: 10 });
  if (invalid.length > 0) {
    return { errors: invalid.map((error) => withCode(error, GRAPHQL_INVALID).toJSON()) };
  }
  const result: ExecutionResult = await execute({
    schema,
    document,
    operationName: request.operationName ?? undefined,
    variableValues: request.variables ?? undefined,
    contextValue,
  });
  // No `data` at all: the request failed before execution, as a variable that does not coerce.
  if (result.data === undefined) {
    return { errors: (result.errors ?? []).map((e) => withCode(e, GRAPHQL_INVALID).toJSON()) };
  }
  return {
    data: result.data,
    ...(result.errors === undefined
      ? {}
      : { errors: result.errors.map((error) => masked(error, report).toJSON()) }),
  };
}

const refused = (code: string, message: string): GraphqlAnswer => ({
  errors: [new GraphQLError(message, { extensions: { code } }).toJSON()],
});

const withCode = (error: GraphQLError, code: string): GraphQLError =>
  new GraphQLError(error.message, { path: error.path, extensions: { code } });

/** A resolver's own `GraphQLError` as it is; anything else masked and reported. */
function masked(error: GraphQLError, report: (error: unknown) => void): GraphQLError {
  const original = error.originalError;
  if (original === undefined || original === null) {
    // An error of the execution itself, such as a non-null field that resolved to null.
    return typeof error.extensions.code === 'string' ? error : withCode(error, GRAPHQL_INTERNAL);
  }
  if (original instanceof GraphQLError && typeof original.extensions.code === 'string') {
    return error;
  }
  // The conflicts of a unit of work answer as REST's 409 codes (ConflictFilter), not as errors.
  if (original instanceof StaleAggregateError || original instanceof TransactionConflictError) {
    const code =
      original instanceof StaleAggregateError ? CONFLICT_CODES.stale : CONFLICT_CODES.retry;
    return new GraphQLError(code, { path: error.path, extensions: { code } });
  }
  report(original);
  return new GraphQLError('Internal error.', {
    path: error.path,
    extensions: { code: GRAPHQL_INTERNAL },
  });
}

/**
 * Why the operation is over a depth or field limit, or `null`. Runs before validation: a spread
 * of a missing fragment, or of one already being expanded (a cycle), is skipped here and refused
 * by validation. The walk stops at the first limit crossed, so a document that spreads
 * fragments into each other costs at most `maxFields` steps.
 */
function complexityOf(
  document: DocumentNode,
  operation: OperationDefinitionNode,
  limits: GraphqlLimits,
): string | null {
  const maxRoot =
    operation.operation === 'mutation' ? limits.maxMutationRootFields : limits.maxRootFields;
  const expanding = new Set<string>();
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }
  let fields = 0;
  let rootFields = 0;
  const walk = (set: SelectionSetNode, depth: number): string | null => {
    if (depth > limits.maxDepth) return `The query is deeper than ${limits.maxDepth} levels.`;
    for (const selection of set.selections) {
      switch (selection.kind) {
        case Kind.FIELD: {
          fields += 1;
          if (depth === 1 && ++rootFields > maxRoot) {
            return `The ${operation.operation} selects more than ${maxRoot} root fields.`;
          }
          if (fields > limits.maxFields) {
            return `The query selects more than ${limits.maxFields} fields.`;
          }
          if (selection.selectionSet !== undefined) {
            const over = walk(selection.selectionSet, depth + 1);
            if (over !== null) return over;
          }
          break;
        }
        case Kind.INLINE_FRAGMENT: {
          const over = walk(selection.selectionSet, depth);
          if (over !== null) return over;
          break;
        }
        case Kind.FRAGMENT_SPREAD: {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (fragment === undefined || expanding.has(name)) break;
          expanding.add(name);
          const over = walk(fragment.selectionSet, depth);
          expanding.delete(name);
          if (over !== null) return over;
          break;
        }
      }
    }
    return null;
  };
  return walk(operation.selectionSet, 1);
}
