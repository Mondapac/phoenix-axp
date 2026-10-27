/**
 * What the bridge found that the design says should not happen (ADR-0020 decision 9; PoC 3
 * R3, R7, R10). Recorded once per kind and engine object, for operators; never hidden.
 *
 * - `orphan-instance`: a second engine instance with a business key the core already adopted.
 * - `completed-outside-core`: a task completed in the engine without the core's completion key.
 * - `completion-superseded`: the engine removed a task while the core's completion was on its
 *   way (the deadline won).
 * - `unknown-instance`: an engine task or instance of this tenant that no core instance knows.
 * - `command-refused`: the engine refused a command for good (an invalid model, a missing
 *   definition, an object of another tenant).
 */
export const INCIDENT_KINDS = [
  'orphan-instance',
  'completed-outside-core',
  'completion-superseded',
  'unknown-instance',
  'command-refused',
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
