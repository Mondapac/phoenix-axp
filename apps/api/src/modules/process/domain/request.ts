import type { Decision } from './task';

/**
 * A submitted request (V3 snapshot at reference, ADR-0007): it keeps the form revision, the
 * process revision and the hash of what was submitted. The engine instance is adopted once,
 * first writer wins: the relay's start acknowledgement or the first task the sync observes.
 * Any other instance with the same business key is an orphan and is removed.
 */
export const REQUEST_STATUSES = [
  'submitted',
  'running',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type Adoption = 'adopted' | 'already-ours' | 'orphan';

/** Whether `instanceId` is (or becomes) the request's instance. */
export function adoptInstance(current: string | null, instanceId: string): Adoption {
  if (current === null) return 'adopted';
  return current === instanceId ? 'already-ours' : 'orphan';
}

/** The final status of a request whose instance ended: deleted in the engine is cancelled. */
export const finalStatus = (decision: Decision | null, deleted: boolean): RequestStatus =>
  deleted ? 'cancelled' : decision === 'approve' ? 'approved' : 'rejected';
