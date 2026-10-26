// The `@phoenix/shared-kernel/authenticated-actor` entry: the constructor of an authenticated
// actor. Only the one file of `identity` that builds actors from a valid session, its
// `Authenticator` (Phase 1), may import this entry (dependency-cruiser rule
// `authenticated-actor-is-built-by-the-authenticator`); the platform's entry adapters never
// build one, and tests use the `/testing` builders.
//
// Named exports only. The constructor checks every field again at run time.
export { mintAuthenticatedActor as authenticatedActor } from './actor-context';
export type { AuthenticatedActorFields } from './actor-context';
