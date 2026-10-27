// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/presentation/calls-handle.ts.
interface UseCaseLike {
  handle(): number;
}

// Violation: a controller reaches a use case through execute only, never handle.
export const violation = (useCase: UseCaseLike): number => useCase.handle();
