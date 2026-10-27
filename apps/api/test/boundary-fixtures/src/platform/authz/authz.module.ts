// Ported from Mondapac apps/api/test/boundary-fixtures/src/platform/authz/authz.module.ts.
import { createUseCaseGate } from './use-case-gate';

// Allowed (use-case-gate-is-built-by-authz): platform/authz builds the gate.
export const allowed = createUseCaseGate();
