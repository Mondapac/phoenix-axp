import type { Id, TenantContext } from '@phoenix/shared-kernel';
import type { Subtree } from '../application/site.repository';

/** One row of a closure table: `tenancy.site_ancestry` or `tenancy.organization_ancestry`. */
interface ClosureRow {
  readonly tenantId: string;
  readonly ancestorId: string;
  readonly descendantId: string;
  readonly depth: number;
}

/**
 * The operations of the open unit's ancestry delegate that the closure maintenance uses, so
 * the site and the organization repositories share one implementation. Every query names the
 * tenant (the tenant guard refuses one that does not).
 */
export interface ClosureDelegate {
  findMany(args: {
    where: {
      tenantId: string;
      ancestorId?: string;
      descendantId?: string;
      depth?: { gt: number };
    };
    select: { ancestorId?: true; descendantId?: true; depth: true };
  }): Promise<{ ancestorId?: string; descendantId?: string; depth: number }[]>;
  count(args: {
    where: { tenantId: string; ancestorId: string; descendantId: string; depth: { gt: number } };
  }): Promise<number>;
  createMany(args: { data: ClosureRow[] }): Promise<unknown>;
  deleteMany(args: {
    where: { tenantId: string; descendantId: { in: string[] }; ancestorId: { in: string[] } };
  }): Promise<unknown>;
}

/**
 * The closure rows of a new node: one per ancestor of its parent, one step further, and its
 * own row at depth 0.
 */
export async function insertNode(
  closure: ClosureDelegate,
  tenant: TenantContext,
  id: string,
  parentId: string | null,
): Promise<void> {
  const tenantId = tenant.tenantId;
  const above =
    parentId === null
      ? []
      : await closure.findMany({
          where: { tenantId, descendantId: parentId },
          select: { ancestorId: true, depth: true },
        });
  await closure.createMany({
    data: [
      { tenantId, ancestorId: id, descendantId: id, depth: 0 },
      ...above.map((row) => ({
        tenantId,
        ancestorId: row.ancestorId!,
        descendantId: id,
        depth: row.depth + 1,
      })),
    ],
  });
}

/** The node and every descendant, with the subtree's height. */
export async function subtreeOf<K extends string>(
  closure: ClosureDelegate,
  tenant: TenantContext,
  id: Id<K>,
): Promise<Subtree<K>> {
  const rows = await closure.findMany({
    where: { tenantId: tenant.tenantId, ancestorId: id },
    select: { descendantId: true, depth: true },
  });
  const below = rows.filter((row) => row.descendantId !== id);
  return {
    ids: [id, ...below.map((row) => row.descendantId as Id<K>)],
    height: below.reduce((height, row) => Math.max(height, row.depth), 0),
  };
}

/**
 * Re-links a subtree under `newParentId` (null: a root). The rows that join the subtree to its
 * old ancestors go; the rows that join it to the new parent's ancestors (the new parent
 * included) come. Rows inside the subtree are unchanged. The caller holds the structure lock.
 */
export async function moveSubtree(
  closure: ClosureDelegate,
  tenant: TenantContext,
  subtree: Subtree<string>,
  newParentId: string | null,
): Promise<void> {
  const tenantId = tenant.tenantId;
  const [rootId] = subtree.ids;
  const inside = [...subtree.ids];
  const oldAbove = await closure.findMany({
    where: { tenantId, descendantId: rootId!, depth: { gt: 0 } },
    select: { ancestorId: true, depth: true },
  });
  if (oldAbove.length > 0) {
    await closure.deleteMany({
      where: {
        tenantId,
        descendantId: { in: inside },
        ancestorId: { in: oldAbove.map((row) => row.ancestorId!) },
      },
    });
  }
  if (newParentId === null) return;

  const newAbove = await closure.findMany({
    where: { tenantId, descendantId: newParentId },
    select: { ancestorId: true, depth: true },
  });
  const below = await closure.findMany({
    where: { tenantId, ancestorId: rootId! },
    select: { descendantId: true, depth: true },
  });
  await closure.createMany({
    data: newAbove.flatMap((ancestor) =>
      below.map((descendant) => ({
        tenantId,
        ancestorId: ancestor.ancestorId!,
        descendantId: descendant.descendantId!,
        depth: ancestor.depth + 1 + descendant.depth,
      })),
    ),
  });
}

/** Strictly below `rootId`. */
export async function isStrictlyBelow(
  closure: ClosureDelegate,
  tenant: TenantContext,
  id: string,
  rootId: string,
): Promise<boolean> {
  const rows = await closure.count({
    where: { tenantId: tenant.tenantId, ancestorId: rootId, descendantId: id, depth: { gt: 0 } },
  });
  return rows > 0;
}
