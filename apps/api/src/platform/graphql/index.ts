// The `platform/graphql` barrel (ADR-0017 decision 8).
export {
  DEFAULT_GRAPHQL_LIMITS,
  GRAPHQL_INTERNAL,
  GRAPHQL_INVALID,
  GRAPHQL_TOO_COMPLEX,
  graphqlRequestBody,
  introspectionAllowed,
  MAX_GRAPHQL_DOCUMENT_LENGTH,
  runGraphql,
  type GraphqlAnswer,
  type GraphqlLimits,
  type GraphqlRequest,
} from './graphql-runner';
