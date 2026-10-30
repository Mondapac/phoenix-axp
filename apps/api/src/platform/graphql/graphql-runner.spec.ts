import {
  GraphQLError,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import {
  DEFAULT_GRAPHQL_LIMITS,
  graphqlRequestBody,
  introspectionAllowed,
  runGraphql,
  type GraphqlLimits,
} from './graphql-runner';
import { StaleAggregateError, TransactionConflictError } from '../unit-of-work/errors';

// A small schema with a recursive type, so depth and field count can be pushed past the limits.
const node: GraphQLObjectType = new GraphQLObjectType({
  name: 'Node',
  fields: () => ({
    name: { type: GraphQLString, resolve: () => 'n' },
    child: { type: node, resolve: () => ({}) },
    children: { type: new GraphQLList(node), resolve: () => [{}, {}] },
  }),
});
const schema = new GraphQLSchema({
  mutation: new GraphQLObjectType({
    name: 'Mutation',
    fields: { touch: { type: GraphQLString, resolve: () => 'touched' } },
  }),
  query: new GraphQLObjectType({
    name: 'Query',
    fields: {
      root: { type: node, resolve: () => ({}) },
      context: { type: GraphQLString, resolve: (_source, _args, context: string) => context },
      expected: {
        type: GraphQLString,
        resolve: () => {
          throw new GraphQLError('Not found.', { extensions: { code: 'thing.not-found' } });
        },
      },
      unexpected: {
        type: GraphQLString,
        resolve: () => {
          throw new Error('secret connection string');
        },
      },
      stale: {
        type: GraphQLString,
        resolve: () => {
          throw new StaleAggregateError('Thing', 'id');
        },
      },
      busy: {
        type: GraphQLString,
        resolve: () => {
          throw new TransactionConflictError('40001');
        },
      },
      count: {
        type: GraphQLInt,
        args: { n: { type: new GraphQLNonNull(GraphQLInt) } },
        resolve: (_source, args: { n: number }) => args.n,
      },
    },
  }),
});

const limits: GraphqlLimits = { ...DEFAULT_GRAPHQL_LIMITS, introspection: false };

describe('runGraphql', () => {
  let reported: unknown[];
  const run = (query: string, extra: Partial<GraphqlLimits> = {}, variables?: object) =>
    runGraphql(
      () => schema,
      { query, ...(variables ? { variables: { ...variables } } : {}) },
      'the-context',
      { ...limits, ...extra },
      (error) => reported.push(error),
    );

  beforeEach(() => {
    reported = [];
  });

  it('runs a query with the context handed to the resolvers', async () => {
    expect(await run('{ context root { name } }')).toEqual({
      data: { context: 'the-context', root: { name: 'n' } },
    });
  });

  it('answers a syntax error as graphql.invalid', async () => {
    const answer = await run('{ root { ');
    expect(answer.data).toBeUndefined();
    expect(answer.errors?.[0]?.extensions).toEqual({ code: 'graphql.invalid' });
  });

  it('stops parsing at the token limit', async () => {
    const answer = await run(`{ ${'context '.repeat(50)}}`, { maxTokens: 20 });
    expect(answer.errors?.[0]).toMatchObject({ extensions: { code: 'graphql.invalid' } });
    expect(answer.errors?.[0]?.message).toMatch(/token/i);
  });

  it('answers an unknown field as graphql.invalid without running anything', async () => {
    const answer = await run('{ unexpected missing }');
    expect(answer.data).toBeUndefined();
    expect(answer.errors?.map((e) => e.extensions?.code)).toEqual(['graphql.invalid']);
    expect(reported).toEqual([]);
  });

  it('refuses introspection unless the limits allow it', async () => {
    const off = await run('{ __schema { queryType { name } } }');
    expect(off.errors?.[0]?.extensions).toEqual({ code: 'graphql.invalid' });
    const on = await run('{ __schema { queryType { name } } }', { introspection: true });
    expect(on).toEqual({ data: { __schema: { queryType: { name: 'Query' } } } });
    // __typename is not introspection of the schema.
    expect(await run('{ __typename }')).toEqual({ data: { __typename: 'Query' } });
  });

  it('refuses a query deeper than the limit, fragments and inline fragments expanded', async () => {
    const six = '{ root { child { child { child { child { name } } } } } }';
    expect(await run(six)).toMatchObject({ data: { root: { child: {} } } });
    const seven = '{ root { child { child { child { child { child { name } } } } } } }';
    expect((await run(seven)).errors?.[0]?.extensions).toEqual({ code: 'graphql.too-complex' });
    const viaFragments = `
      { root { ...A } }
      fragment A on Node { child { ...B } }
      fragment B on Node { child { ... on Node { child { child { child { name } } } } } }`;
    const answer = await run(viaFragments);
    expect(answer.data).toBeUndefined();
    expect(answer.errors?.[0]?.extensions).toEqual({ code: 'graphql.too-complex' });
  });

  it('counts each spread of a fragment, so nested spreads cannot multiply the work', async () => {
    const fanOut = `
      { root { ...A } }
      fragment A on Node { children { ...B ...B ...B ...B ...B ...B ...B ...B } }
      fragment B on Node { children { ...C ...C ...C ...C ...C ...C ...C ...C } }
      fragment C on Node { children { name name2: name name3: name name4: name } }`;
    const answer = await run(fanOut);
    expect(answer.data).toBeUndefined();
    expect(answer.errors?.[0]?.message).toBe('The query selects more than 200 fields.');
    const wide = `{ root { ${Array.from({ length: 201 }, (_, i) => `a${i}: name`).join(' ')} } }`;
    expect((await run(wide)).errors?.[0]?.message).toBe('The query selects more than 200 fields.');
  });

  it('bounds the root fields, so aliases cannot repeat a use case call many times', async () => {
    const roots = (n: number) =>
      `{ ${Array.from({ length: n }, (_, i) => `a${i}: root { name }`).join(' ')} }`;
    expect((await run(roots(3))).errors).toBeUndefined();
    const over = await run(roots(4));
    expect(over.data).toBeUndefined();
    expect(over.errors?.[0]).toMatchObject({
      message: 'The query selects more than 3 root fields.',
      extensions: { code: 'graphql.too-complex' },
    });
    // Root fields reached through a fragment count the same.
    const viaFragment = `{ ...R ...R } fragment R on Query { ${Array.from({ length: 2 }, (_, i) => `b${i}: context`).join(' ')} }`;
    expect((await run(viaFragment)).errors?.[0]?.extensions).toEqual({
      code: 'graphql.too-complex',
    });
  });

  it('runs one mutation field per request, so writes cannot be batched by aliases', async () => {
    expect(await run('mutation { touch }')).toEqual({ data: { touch: 'touched' } });
    const two = await run('mutation { a: touch b: touch }');
    expect(two.data).toBeUndefined();
    expect(two.errors?.[0]).toMatchObject({
      message: 'The mutation selects more than 1 root fields.',
      extensions: { code: 'graphql.too-complex' },
    });
  });

  it('builds no schema for a document refused by its size, and survives fragment cycles', async () => {
    let built = 0;
    const counted = (query: string) =>
      runGraphql(
        () => {
          built += 1;
          return schema;
        },
        { query },
        null,
        limits,
        () => undefined,
      );
    await counted('{ a: context b: context c: context d: context }');
    await counted('{ root { ');
    expect(built).toBe(0);
    const cycle = await counted(
      '{ ...A } fragment A on Query { ...B } fragment B on Query { ...A }',
    );
    expect(cycle.errors?.[0]?.extensions).toEqual({ code: 'graphql.invalid' });
    const missing = await counted('{ ...Nope }');
    expect(missing.errors?.[0]?.extensions).toEqual({ code: 'graphql.invalid' });
    expect(built).toBe(2);
  });

  it('keeps a resolver GraphQLError with its code and masks any other error', async () => {
    const answer = await run('{ expected unexpected context }');
    expect(answer.data).toEqual({ expected: null, unexpected: null, context: 'the-context' });
    expect(answer.errors).toEqual([
      { message: 'Not found.', path: ['expected'], extensions: { code: 'thing.not-found' } },
      { message: 'Internal error.', path: ['unexpected'], extensions: { code: 'internal' } },
    ]);
    expect(JSON.stringify(answer)).not.toContain('secret');
    expect(reported).toEqual([new Error('secret connection string')]);
  });

  it('answers unit-of-work conflicts with the 409 codes of REST', async () => {
    const answer = await run('{ stale busy }');
    expect(answer.errors?.map((e) => e.extensions?.code)).toEqual([
      'conflict.stale',
      'conflict.retry',
    ]);
    expect(reported).toEqual([]);
  });

  it('answers a variable that does not coerce as graphql.invalid', async () => {
    const answer = await run('query Q($n: Int!) { count(n: $n) }', {}, { n: 'x' });
    expect(answer.errors?.[0]?.extensions).toEqual({ code: 'graphql.invalid' });
    expect(await run('query Q($n: Int!) { count(n: $n) }', {}, { n: 3 })).toEqual({
      data: { count: 3 },
    });
  });

  it('needs the operation named when the document holds several', async () => {
    const answer = await run('query A { context } query B { context }');
    expect(answer.errors?.[0]?.extensions).toEqual({ code: 'graphql.invalid' });
  });
});

describe('the GraphQL request body', () => {
  it('accepts a query with optional variables and operation name', () => {
    expect(graphqlRequestBody.safeParse({ query: '{ a }' }).success).toBe(true);
    expect(
      graphqlRequestBody.safeParse({ query: '{ a }', variables: null, operationName: null })
        .success,
    ).toBe(true);
  });

  it('refuses a batch, an unknown key, an empty or an oversized document', () => {
    expect(graphqlRequestBody.safeParse([{ query: '{ a }' }]).success).toBe(false);
    expect(graphqlRequestBody.safeParse({ query: '{ a }', extensions: {} }).success).toBe(false);
    expect(graphqlRequestBody.safeParse({ query: '' }).success).toBe(false);
    expect(graphqlRequestBody.safeParse({ query: 'x'.repeat(20_001) }).success).toBe(false);
  });
});

describe('introspectionAllowed', () => {
  it('is on only in an explicit development or test start', () => {
    expect(introspectionAllowed({ nodeEnv: 'development', nodeEnvExplicit: true })).toBe(true);
    expect(introspectionAllowed({ nodeEnv: 'test', nodeEnvExplicit: true })).toBe(true);
    expect(introspectionAllowed({ nodeEnv: 'production', nodeEnvExplicit: true })).toBe(false);
    expect(introspectionAllowed({ nodeEnv: 'development', nodeEnvExplicit: false })).toBe(false);
  });
});
