import { parse } from 'graphql';

// Violation: only platform/graphql/ runs GraphQL requests.
export const violation = parse;
