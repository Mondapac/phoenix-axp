// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/application/reaches-use-case-gate.ts.
import { createUseCaseGate } from '../../../platform/authz/use-case-gate';

// Violation (modules-reach-authz-through-its-barrel and use-case-gate-is-built-by-authz): a
// module never reaches the gate's file; it injects USE_CASE_GATE from the barrel (M1).
export const violation = createUseCaseGate();
