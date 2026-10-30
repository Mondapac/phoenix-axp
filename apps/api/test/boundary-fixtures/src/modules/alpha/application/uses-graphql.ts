import { GraphQLSchema } from 'graphql';

// Violation: graphql belongs to the HTTP edge; the application layer knows only its use cases.
export const violation = GraphQLSchema;
