import path from 'node:path';
import { RETIRED_PERMISSION_KEYS } from '../../src/platform/authz/retired-permission-keys';
import {
  discoverUseCases,
  readList,
  type DiscoveryProblem,
  type ListedDeclaration,
} from './use-case-discovery';

// Ported from Mondapac apps/api/test/authz/use-cases.spec.ts, without the seller-state and job
// cases (jobs join with slice 1.2). The CI check of Phoenix ADR-0004 decision 4: every use case
// of the API is found by its path, carries a valid declaration of its own (a use case without
// an access rule fails here), and every non-permission rule is on the checked-in list, so each
// one is seen in review. To
// accept a new entry, add it to test/contracts/access-declarations.json, sorted by name.

const SOURCE_ROOT = path.resolve(__dirname, '../../src');
const LIST = path.resolve(__dirname, '../contracts/access-declarations.json');
const FIXTURES = path.join(__dirname, 'fixtures');

// One TypeScript program over the source tree takes a few seconds on a cold machine.
const TIMEOUT_MS = 60_000;

const lines = (problems: readonly DiscoveryProblem[]): string[] =>
  problems.map(({ code, file, detail }) => [code, file, detail].filter(Boolean).join(' ')).sort();

describe('use cases of the API (ADR-0004 decision 4)', () => {
  const listed = readList<ListedDeclaration[]>(LIST);

  it(
    'passes every check, against the checked-in list and the retired keys',
    () => {
      const result = discoverUseCases({
        sourceRoot: SOURCE_ROOT,
        listed,
        retiredKeys: RETIRED_PERMISSION_KEYS,
      });

      expect(lines(result.problems)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it('keeps the checked-in list sorted by name, one entry per use case', () => {
    const names = listed.map((entry) => entry.name);

    expect(names).toEqual([...new Set(names)].sort());
  });
});

describe('use-case discovery fixtures', () => {
  it(
    'accepts a tree with one use case of each rule kind',
    () => {
      const result = discoverUseCases({
        sourceRoot: path.join(FIXTURES, 'valid'),
        listed: readList(path.join(FIXTURES, 'valid/access-declarations.json')),
        retiredKeys: [],
      });

      expect(lines(result.problems)).toEqual([]);
      expect(result.useCases.map((useCase) => useCase.declaration.name).sort()).toEqual([
        'alpha.purge-expired',
        'alpha.sign-in',
        'alpha.sign-out',
        'alpha.suspend-tenant',
        'alpha.view-orders',
        'alpha.view-summary',
      ]);
    },
    TIMEOUT_MS,
  );

  it(
    'refuses each broken case, and nothing else',
    () => {
      const result = discoverUseCases({
        sourceRoot: path.join(FIXTURES, 'broken'),
        listed: readList(path.join(FIXTURES, 'broken/access-declarations.json')),
        retiredKeys: ['beta.things.purge'],
      });
      const useCases = 'modules/beta/application/use-cases';

      expect(lines(result.problems)).toEqual([
        // A module's catalogue declares only that module's keys.
        'catalogue-module-mismatch modules/gamma/contracts/index.ts delta',
        // L2: entry points sit in presentation/ (a controller, under an alias; an inline job).
        'controller-outside-presentation modules/beta/application/beta.controller.ts BetaController',
        // Each file: exactly one exported direct subclass, with a valid declaration of its own.
        `declaration-invalid ${useCases}/bad-declaration.use-case.ts rule-kind-unknown`,
        `declaration-invalid ${useCases}/no-declaration.use-case.ts declaration-missing`,
        `execute-overridden ${useCases}/overrides-execute.use-case.ts OverridesExecute`,
        `export-count ${useCases}/no-export.use-case.ts 0`,
        `export-count ${useCases}/two-exports.use-case.ts 2`,
        // HF4: a use case never extends another one, even with its own declaration.
        `extends-use-case ${useCases}/child.use-case.ts Child`,
        `file-misnamed ${useCases}/Bad_Name.use-case.ts Bad_Name.use-case.ts`,
        `file-misnamed ${useCases}/helpers.ts helpers.ts`,
        `file-misnamed ${useCases}/nested/deep.use-case.ts deep.use-case.ts`,
        'key-retired modules/beta/contracts/index.ts beta.things.purge',
        `key-undeclared ${useCases}/undeclared-key.use-case.ts beta.things.unknown`,
        // A platform key and a tenant key in one rule: no population holds both.
        `keys-span-scopes ${useCases}/mixed-scopes.use-case.ts`,
        // The list, both ways: a changed rule is one missing and one stale entry.
        `list-entry-missing ${useCases}/listed-as-system.use-case.ts beta.listed-as-system`,
        `list-entry-missing ${useCases}/unlisted-anonymous.use-case.ts beta.unlisted-anonymous`,
        'list-entry-stale (checked-in list) beta.listed-as-system',
        'list-entry-stale (checked-in list) beta.removed',
        `name-duplicate ${useCases}/sign-out.use-case.ts beta.sign-out`,
        `name-duplicate ${useCases}/wrong-name.use-case.ts beta.sign-out`,
        `name-mismatch ${useCases}/wrong-name.use-case.ts beta.sign-out (expected beta.wrong-name)`,
        'use-case-file-misplaced modules/beta/application/stray.use-case.ts',
        // Found by the type checker: by name, through an alias, and an anonymous class.
        'use-case-outside-glob modules/beta/application/sneaky.ts (anonymous class)',
        'use-case-outside-glob modules/beta/application/sneaky.ts Aliased',
        'use-case-outside-glob modules/beta/application/sneaky.ts Sneaky',
        'use-cases-folder-misplaced modules/beta/domain/use-cases/thing.ts',
      ]);
    },
    TIMEOUT_MS,
  );

  it(
    'fails when an entry is missing from the list, or the list holds one too many',
    () => {
      const valid = path.join(FIXTURES, 'valid');
      const listed = readList<ListedDeclaration[]>(path.join(valid, 'access-declarations.json'));

      const missing = discoverUseCases({
        sourceRoot: valid,
        listed: listed.filter((entry) => entry.name !== 'alpha.sign-in'),
        retiredKeys: [],
      });
      const extra = discoverUseCases({
        sourceRoot: valid,
        listed: [...listed, { name: 'alpha.view-orders', rule: 'permissions' }],
        retiredKeys: [],
      });

      expect(lines(missing.problems)).toEqual([
        'list-entry-missing modules/alpha/application/use-cases/sign-in.use-case.ts alpha.sign-in',
      ]);
      expect(lines(extra.problems)).toEqual([
        'list-entry-stale (checked-in list) alpha.view-orders',
      ]);
    },
    TIMEOUT_MS,
  );

  it(
    'refuses a declared key that is on the retired list',
    () => {
      const valid = path.join(FIXTURES, 'valid');
      const result = discoverUseCases({
        sourceRoot: valid,
        listed: readList(path.join(valid, 'access-declarations.json')),
        retiredKeys: ['alpha.tenants.suspend'],
      });

      expect(lines(result.problems)).toEqual([
        'key-retired modules/alpha/contracts/index.ts alpha.tenants.suspend',
      ]);
    },
    TIMEOUT_MS,
  );
});
