import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';

// The rules of the two trees of a tenant, the site tree and the organization tree (ADR-0018
// decisions 2 and 3). Pure: the repository reads the facts under the tenant's structure lock
// and the use case asks these functions.

/**
 * The most levels an organization chart may have. A chart is not bounded by the tenant's site
 * ceiling; this only keeps a runaway tree out.
 */
export const MAX_ORGANIZATION_DEPTH = 32;

/** A node is placed deeper than the tenant's ceiling allows. */
export type DepthExceeded = { readonly code: 'tenancy.tree.depth-exceeded' };
/** A node would move under itself or under one of its descendants. */
export type MoveIntoOwnSubtree = { readonly code: 'tenancy.tree.move-into-own-subtree' };

/**
 * The depth of a new child of a node at `parentDepth` (null: a root), refused when the tree
 * would get more than `maxDepth` levels. Depth counts from 0 at the root, so a tenant with the
 * default ceiling of 8 has depths 0 to 7.
 */
export function childDepth(
  parentDepth: number | null,
  maxDepth: number,
): Result<number, DepthExceeded> {
  const depth = parentDepth === null ? 0 : parentDepth + 1;
  return depth < maxDepth ? ok(depth) : err({ code: 'tenancy.tree.depth-exceeded' });
}

/** What a move needs to know about the node, its subtree and the new parent. */
export interface MoveFacts {
  /** The node's current depth. */
  readonly depth: number;
  /** The deepest level below the node, relative to it (0 for a leaf). */
  readonly subtreeHeight: number;
  /** The new parent, or null to make the node a root. */
  readonly newParent: {
    readonly depth: number;
    /** True when the new parent is the node itself or lies within its subtree. */
    readonly withinSubtree: boolean;
  } | null;
  readonly maxDepth: number;
}

/** The plan of a move: every node of the subtree shifts its depth by `depthShift`. */
export interface MovePlan {
  readonly depth: number;
  readonly depthShift: number;
}

/**
 * Decides a move (ADR-0018 decision 6: moving a site recomputes access from the new tree): no
 * cycle, and the deepest node of the moved subtree stays under the ceiling.
 */
export function planMove(facts: MoveFacts): Result<MovePlan, DepthExceeded | MoveIntoOwnSubtree> {
  if (facts.newParent?.withinSubtree === true) {
    return err({ code: 'tenancy.tree.move-into-own-subtree' });
  }
  const placed = childDepth(facts.newParent?.depth ?? null, facts.maxDepth);
  if (!placed.ok) return placed;
  if (placed.value + facts.subtreeHeight >= facts.maxDepth) {
    return err({ code: 'tenancy.tree.depth-exceeded' });
  }
  return ok({ depth: placed.value, depthShift: placed.value - facts.depth });
}
