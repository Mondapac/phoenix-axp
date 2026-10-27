/**
 * A process instance as the core sees it (ADR-0005; ADR-0020 decision 9): one run of exactly one
 * process revision. Its id is the engine instance's business key. Pure rules, no I/O.
 *
 *   starting --(the engine instance is adopted)--> running --(the engine ended it)--> completed
 *                                                      +--(deleted in the engine)--> cancelled
 */
export const INSTANCE_STATUSES = ['starting', 'running', 'completed', 'cancelled'] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

/**
 * First writer wins (ADR-0020 decision 9): the first engine instance recorded in the core for a
 * business key is the instance; any other engine instance with that key is an orphan.
 * `adopt` when nothing is recorded yet, `same` when `candidate` is the recorded one.
 */
export function adoptionOf(
  recorded: string | null,
  candidate: string,
): 'adopt' | 'same' | 'orphan' {
  if (recorded === null) return 'adopt';
  return recorded === candidate ? 'same' : 'orphan';
}

/** The status an instance ends with: deleted in the engine (an operator) is `cancelled`. */
export const endStatusOf = (deleted: boolean): InstanceStatus =>
  deleted ? 'cancelled' : 'completed';

export const isInstanceOpen = (status: InstanceStatus): boolean =>
  status === 'starting' || status === 'running';
