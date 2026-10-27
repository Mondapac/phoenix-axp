import type { Temporal } from '@phoenix/shared-kernel';

/**
 * A command of the core to the engine (ADR-0005 decision 3; ADR-0020 decision 7). Written in
 * the unit of the state change, relayed at least once with a lease. Each kind is idempotent on
 * the engine side by its own key:
 *
 * - `deploy-revision`: the deployment name `<processKey>@<revisionId>`;
 * - `start-instance`: the core instance id as business key, found before started (R3);
 * - `complete-task`: the command id, stored on the engine task before it is completed (R4);
 * - `delete-orphan`: deleting an instance that is gone is not an error.
 */
export const COMMAND_KINDS = [
  'deploy-revision',
  'start-instance',
  'complete-task',
  'delete-orphan',
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/**
 * The longest one engine call may take. A command makes at most
 * {@link MAX_CALLS_PER_COMMAND} calls in a row.
 */
export const ENGINE_CALL_TIMEOUT_MS = 5000;
export const MAX_CALLS_PER_COMMAND = 6;

/**
 * How long a claim holds a command: at least twice the longest delivery (ADR-0020 decision 7),
 * so a slow relay never sees its command claimed again while its calls can still be running.
 */
export const COMMAND_LEASE_MS = 2 * ENGINE_CALL_TIMEOUT_MS * MAX_CALLS_PER_COMMAND;

/** Commands per claim and tenant. */
export const RELAY_BATCH_SIZE = 20;

/** The retry after an unreachable engine: `min(5 s × 2^(attempts − 1), 5 min)`. */
export const RETRY_BASE_MS = 5000;
export const RETRY_MAX_MS = 300_000;

export function retryDelayMs(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError('attempts starts at 1');
  return Math.min(RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 16), RETRY_MAX_MS);
}

/** When a command whose `attempts`-th call failed comes due again. */
export const retryAfter = (now: Temporal.Instant, attempts: number): Temporal.Instant =>
  now.add({ milliseconds: retryDelayMs(attempts) });

/**
 * Values the core passes to the engine: ids, codes, numbers and flags only (ADR-0005
 * decision 7), never free text or personal data.
 */
export type EngineVariableValue = string | number | boolean;
export type EngineVariables = Readonly<Record<string, EngineVariableValue>>;

/** A variable name the engine and the model can use, never one of the core's own. */
const VARIABLE_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;
/** A code or an id: no spaces, no free text. */
const VARIABLE_TEXT = /^[A-Za-z0-9._:-]{1,64}$/;
/** The core's own variables, set by the bridge only. */
export const RESERVED_VARIABLE_PREFIX = 'phoenix';
export const MAX_VARIABLES = 32;

/** Whether `variables` may be sent to the engine: the field name of the first bad one, or null. */
export function invalidVariable(variables: Readonly<Record<string, unknown>>): string | null {
  const entries = Object.entries(variables);
  if (entries.length > MAX_VARIABLES) return 'variables';
  for (const [name, value] of entries) {
    if (!VARIABLE_NAME.test(name) || name.startsWith(RESERVED_VARIABLE_PREFIX)) return name;
    const valid =
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isSafeInteger(value)) ||
      (typeof value === 'string' && VARIABLE_TEXT.test(value));
    if (!valid) return name;
  }
  return null;
}
