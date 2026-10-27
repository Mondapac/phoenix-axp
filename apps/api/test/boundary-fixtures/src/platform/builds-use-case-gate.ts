// Ported from Mondapac apps/api/test/boundary-fixtures/src/platform/builds-use-case-gate.ts.
import { createUseCaseGate } from './authz/use-case-gate';

// Violation (use-case-gate-is-built-by-authz): only platform/authz builds a gate (M1).
export const violation = createUseCaseGate();
