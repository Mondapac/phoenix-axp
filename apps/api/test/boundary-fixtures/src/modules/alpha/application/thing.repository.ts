// Ported from Mondapac apps/api/test/boundary-fixtures/src/modules/alpha/application/thing.repository.ts.
// The repository port of the fixture module (a `*.repository.ts` file in application/).
export interface ThingRepository {
  find(id: string): Promise<string | null>;
}
