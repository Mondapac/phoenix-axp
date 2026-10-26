import type { Prisma } from '../../generated/prisma/client';
import { GUARDED_OPERATIONS, tenantGuardExtension, type GuardedOperation } from './tenant-guard';
import type { ModelMap } from './model-map';
import type { PrismaRoot } from './prisma-root';
import { unitStorage } from './unit-store';

/**
 * The guarded client (ported from Mondapac's platform persistence design, "P", 3.3): the base
 * client with the tenant guard applied once. Every unit opens its interactive transaction on
 * it, so every query reaches the database only through the guard. Internal to
 * `platform/persistence/`.
 */
export function createGuardedClient(root: PrismaRoot, map: ModelMap) {
  return root.$extends(tenantGuardExtension(map, () => unitStorage.getStore()));
}

export type GuardedClient = ReturnType<typeof createGuardedClient>;

/** Nest token of the guarded client; not exported from the persistence module. */
export const GUARDED_CLIENT = Symbol('GUARDED_CLIENT');

/** The client property of each model (`isolationProbe`): the model delegates and nothing else. */
type ModelProperty = Uncapitalize<Prisma.ModelName>;

/** One model's part of the view: the guarded operations of its delegate, nothing else. */
type DelegateView<Delegate> = Readonly<Pick<Delegate, Extract<keyof Delegate, GuardedOperation>>>;

/**
 * What `PrismaService.tx(tenant)` hands a repository: per model, the guarded operations of
 * the open unit's client and nothing else. No `$transaction`, no raw SQL, no `$connect`,
 * `$disconnect`, `$on` or `$extends`; no `$parent`, `$name` or `fields` on a delegate either.
 * `Prisma.TransactionClient` is assignable to it in neither direction (P 3.3).
 */
export type TenantTransaction = {
  readonly [Property in ModelProperty]: DelegateView<GuardedClient[Property]>;
};

/**
 * The view of the open unit's transaction client. The view and each of its delegates are
 * frozen objects with no prototype. A delegate holds only the functions of
 * {@link GUARDED_OPERATIONS}, each bound to Prisma's delegate: Prisma's delegate itself is
 * never reachable, because it carries `$parent`, the unguarded interactive-transaction client
 * it came from.
 */
export function modelDelegatesOf(client: object, map: ModelMap): TenantTransaction {
  const view: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const entry of Object.values(map.models)) {
    const delegate = (client as Record<string, unknown>)[entry.clientProperty] as Record<
      string,
      unknown
    >;
    const operations: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const operation of GUARDED_OPERATIONS) {
      const action = delegate[operation];
      if (typeof action !== 'function') {
        throw new Error(`Prisma delegate ${entry.clientProperty} has no ${operation}`);
      }
      operations[operation] = (action as (...args: unknown[]) => unknown).bind(delegate);
    }
    view[entry.clientProperty] = Object.freeze(operations);
  }
  return Object.freeze(view) as TenantTransaction;
}
