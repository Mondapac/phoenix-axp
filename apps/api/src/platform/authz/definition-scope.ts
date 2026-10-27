// Phoenix ADR-0024 decision 2: a key over run-time definitions (Objects, forms) is held per
// role with a definition qualifier, `all` or a list of definition ids. No template file:
// Mondapac has no run-time definitions. Pure: no Nest, no Prisma, no I/O.
import type { Id } from '@phoenix/shared-kernel';

/** The most definition ids one qualifier may list: the bound identity's CHECK repeats. */
export const MAX_QUALIFIER_DEFINITIONS = 256;

/**
 * Which definitions a grant of a qualified key applies to: every definition of the tenant,
 * those created later included (`all`), or the listed ones. A role that confers a qualified key
 * without a qualifier covers no definition (fail closed); a system role covers `all`.
 */
export type DefinitionQualifier =
  | { readonly all: true }
  | { readonly all: false; readonly definitionIds: ReadonlySet<Id<'Definition'>> };

export const ALL_DEFINITIONS: DefinitionQualifier = Object.freeze({ all: true });

/**
 * What one grant holds over definitions: the qualifier of each qualified key it confers. A key
 * absent from the map covers no definition.
 */
export interface DefinitionScopedGrant {
  readonly qualifiers: ReadonlyMap<string, DefinitionQualifier>;
}

/**
 * Whether a grant's `key` applies to `definitionId` (ADR-0024 decision 2). The use case checks
 * it next to `grantCoversSite`, in the order tenant, site, definition, record ownership, field
 * mode, from the actor's grants, never from input.
 */
export function grantCoversDefinition(
  grant: DefinitionScopedGrant,
  key: string,
  definitionId: Id<'Definition'>,
): boolean {
  const qualifier = grant.qualifiers.get(key);
  if (qualifier === undefined) return false;
  return qualifier.all || qualifier.definitionIds.has(definitionId);
}

/** True when `inner` applies to no definition `outer` does not (GrantPolicy, decision 10). */
export function qualifierWithin(inner: DefinitionQualifier, outer: DefinitionQualifier): boolean {
  if (outer.all) return true;
  if (inner.all) return false;
  for (const id of inner.definitionIds) if (!outer.definitionIds.has(id)) return false;
  return true;
}
