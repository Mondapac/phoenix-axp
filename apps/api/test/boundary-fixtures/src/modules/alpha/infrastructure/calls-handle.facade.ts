// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/infrastructure/calls-handle.facade.ts.
interface UseCaseLike {
  handle(): number;
}

// Violation (W7): a facade implementation reaches a use case through execute only.
export class AlphaFacadeLike {
  constructor(private readonly useCase: UseCaseLike) {}

  run(): number {
    return this.useCase.handle();
  }
}
