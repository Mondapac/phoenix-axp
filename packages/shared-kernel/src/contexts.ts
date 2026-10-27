// The `@phoenix/shared-kernel/contexts` entry: the constructors of the actor and call
// contexts. Only the platform's entry adapters build these contexts, so this entry is reachable
// from `apps/api/src/platform/` and from tests only (dependency-cruiser rule
// `contexts-are-built-by-platform`). The types, the minted check and `ContextMismatchError`
// stay on the main entry, which every layer may import.
//
// Named exports only. The authenticated-actor constructor is not here: it has its own entry,
// `@phoenix/shared-kernel/authenticated-actor`, reachable from the one file of `identity` that
// builds actors.
export { anonymousActor, systemActor } from './actor-context';
export { createCallContext } from './call-context';
