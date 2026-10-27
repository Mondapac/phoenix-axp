import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import * as ts from 'typescript';

const API_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(API_ROOT, '../..');
const FIXTURES = path.join(__dirname, 'boundary-fixtures');

// The cold start of the type-aware ESLint run and of dependency-cruiser exceeds Jest's
// default 5 s when the machine is busy; each runs once, in a beforeAll with this timeout.
const SETUP_TIMEOUT_MS = 60_000;

interface Rule {
  name: string;
  severity: string;
}

interface Violation {
  from: string;
  to: string;
  rule: Rule;
}

interface CruiseResult {
  modules: { source: string; dependencies: { module: string; resolved: string }[] }[];
  summary: { violations: Violation[]; ruleSetUsed: { forbidden: Rule[] } };
}

/** Runs the real dependency-cruiser configuration against the fixture tree. */
function cruiseFixtures(): CruiseResult {
  let output: string;
  try {
    output = execFileSync(
      process.execPath,
      [
        path.join(API_ROOT, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        'src',
        '--config',
        path.join(API_ROOT, '.dependency-cruiser.cjs'),
        '--output-type',
        'json',
      ],
      { cwd: FIXTURES, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    // dependency-cruiser exits non-zero when it finds violations; the report is on stdout.
    output = (error as { stdout: string }).stdout;
  }
  return JSON.parse(output) as CruiseResult;
}

/**
 * Every name a TypeScript file exports, read from its syntax: declarations, export lists,
 * re-exports (`export *` is reported as `*`) and default exports. Types count too.
 */
function exportedNames(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause === undefined) names.push('*');
      else if (ts.isNamespaceExport(clause)) names.push(clause.name.text);
      else names.push(...clause.elements.map((element) => element.name.text));
    } else if (ts.isExportAssignment(statement)) {
      names.push('default');
    } else if (ts.canHaveModifiers(statement)) {
      const modifiers = ts.getModifiers(statement)?.map((modifier) => modifier.kind) ?? [];
      if (!modifiers.includes(ts.SyntaxKind.ExportKeyword)) continue;
      if (modifiers.includes(ts.SyntaxKind.DefaultKeyword)) names.push('default');
      else if (ts.isVariableStatement(statement)) {
        names.push(
          ...statement.declarationList.declarations.map((variable) =>
            variable.name.getText(source),
          ),
        );
      } else {
        const { name } = statement as ts.Statement & { name?: ts.Node };
        names.push(name?.getText(source) ?? '?');
      }
    }
  }
  return names.sort();
}

/** `<ESLint rule>: <design rule>` of a message, the design rule being its message prefix. */
function label(message: Linter.LintMessage): string {
  const rule = /\b([a-z]+(?:-[a-z]+)+): /.exec(message.message)?.[1] ?? message.message;
  return `${message.ruleId}: ${rule}`;
}

const times = (count: number, entry: string): string[] => Array<string>(count).fill(entry);
const syntax = (rule: string, count = 1): string[] => times(count, `no-restricted-syntax: ${rule}`);
const properties = (rule: string, count = 1): string[] =>
  times(count, `no-restricted-properties: ${rule}`);
const imports = (rule: string, count = 1): string[] =>
  times(count, `@typescript-eslint/no-restricted-imports: ${rule}`);
const tenantLiterals = (count = 1): string[] => syntax('no-tenant-literals', count);
const kernelImports = (count = 1): string[] =>
  times(count, 'no-restricted-imports: kernel-imports-only-itself');

describe('architecture boundaries (ADR-01, ADR-02)', () => {
  describe('dependency-cruiser', () => {
    let cruise: CruiseResult;
    let found: string[];

    beforeAll(() => {
      cruise = cruiseFixtures();
      found = cruise.summary.violations
        .map((violation) => `${violation.rule.name}: ${violation.from}`)
        .sort();
    }, SETUP_TIMEOUT_MS);

    it('declares these rules, each as an error', () => {
      const rules = cruise.summary.ruleSetUsed.forbidden;

      expect(rules.map((rule) => rule.name).sort()).toEqual([
        'application-does-not-know-delivery',
        'authenticated-actor-is-built-by-the-authenticator',
        'contexts-are-built-by-platform',
        'database-driver-only-in-infrastructure',
        'domain-is-pure',
        'kernel-only-through-package-entries',
        'kernel-testing-only-in-tests',
        'module-internals-are-private',
        'module-public-api-only',
        'modules-reach-authz-through-its-barrel',
        'no-circular',
        'persistence-internals-are-private',
        'persistence-root-is-private',
        'platform-does-not-import-modules',
        'prisma-only-in-infrastructure',
        'repositories-stay-behind-use-cases',
        'request-actor-is-attached-by-the-actor-guard',
        'temporal-only-through-kernel',
        'tenant-context-is-attached-by-the-guard',
        'tenant-context-only-through-the-decorator',
        'tenant-exemption-is-platform-only',
        'use-case-gate-is-built-by-authz',
        'use-cases-are-the-only-way-in',
      ]);
      expect(rules.filter((rule) => rule.severity !== 'error')).toEqual([]);
      expect(cruise.summary.violations.filter((v) => v.rule.severity !== 'error')).toEqual([]);
    });

    it('reports every deliberate violation in the fixtures, and nothing else', () => {
      expect(found).toEqual([
        'application-does-not-know-delivery: src/modules/alpha/application/knows-delivery.ts',
        'authenticated-actor-is-built-by-the-authenticator: src/modules/identity/application/mints-authenticated-actor.ts',
        'authenticated-actor-is-built-by-the-authenticator: src/platform/mints-authenticated-actor.ts',
        'contexts-are-built-by-platform: src/modules/alpha/application/builds-call-context.ts',
        'contexts-are-built-by-platform: src/modules/alpha/application/mints-actor-context.ts',
        'contexts-are-built-by-platform: src/modules/alpha/application/uses-context-types.ts',
        'database-driver-only-in-infrastructure: src/platform/uses-database-driver.ts',
        'domain-is-pure: src/modules/alpha/domain/does-io.ts',
        'domain-is-pure: src/modules/alpha/domain/imports-application.ts',
        'kernel-only-through-package-entries: src/modules/alpha/infrastructure/reaches-kernel-by-path.ts',
        'kernel-only-through-package-entries: src/platform/binds-built-test-fake.ts',
        'kernel-only-through-package-entries: src/platform/reaches-kernel-dist-by-path.ts',
        'kernel-only-through-package-entries: src/platform/reaches-kernel-dist.ts',
        'kernel-only-through-package-entries: src/platform/reaches-kernel-subpath.ts',
        'kernel-testing-only-in-tests: packages/shared-kernel/src/index.ts',
        'kernel-testing-only-in-tests: src/platform/binds-built-test-fake.ts',
        'kernel-testing-only-in-tests: src/platform/binds-test-fake.ts',
        'module-internals-are-private: src/platform/reaches-into-module.ts',
        'module-public-api-only: src/modules/alpha/application/reaches-into-module.ts',
        'modules-reach-authz-through-its-barrel: src/modules/alpha/application/reaches-use-case-gate.ts',
        'no-circular: src/modules/alpha/domain/circular-a.ts',
        'persistence-internals-are-private: src/modules/alpha/application/reaches-audit-writer.ts',
        'persistence-internals-are-private: src/modules/alpha/application/uses-prisma-service.ts',
        'persistence-internals-are-private: src/modules/alpha/application/uses-prisma-via-barrel.ts',
        'persistence-root-is-private: src/modules/alpha/infrastructure/reaches-audit-writer.ts',
        'persistence-root-is-private: src/modules/alpha/infrastructure/uses-prisma-root.ts',
        'platform-does-not-import-modules: src/platform/imports-module-index.ts',
        'platform-does-not-import-modules: src/platform/reaches-into-module.ts',
        'prisma-only-in-infrastructure: src/modules/alpha/presentation/uses-prisma.ts',
        'repositories-stay-behind-use-cases: src/modules/alpha/presentation/jobs/reaches-repository.ts',
        'request-actor-is-attached-by-the-actor-guard: src/modules/alpha/presentation/attaches-actor.ts',
        'temporal-only-through-kernel: src/platform/uses-js-temporal-polyfill.ts',
        'temporal-only-through-kernel: src/platform/uses-temporal-polyfill.ts',
        'tenant-context-is-attached-by-the-guard: src/platform/reaches-attached-tenant-context.ts',
        'tenant-context-only-through-the-decorator: src/modules/alpha/application/mints-tenant-context-indirectly.ts',
        'tenant-context-only-through-the-decorator: src/modules/alpha/application/mints-tenant-context.ts',
        'tenant-context-only-through-the-decorator: src/modules/alpha/infrastructure/copies-health-exemption.ts',
        'tenant-context-only-through-the-decorator: src/modules/alpha/presentation/exempt-controller.ts',
        'tenant-exemption-is-platform-only: src/modules/alpha/presentation/exempt-controller.ts',
        'tenant-exemption-is-platform-only: src/platform/tenant-context/index.ts',
        'use-case-gate-is-built-by-authz: src/modules/alpha/application/reaches-use-case-gate.ts',
        'use-case-gate-is-built-by-authz: src/platform/builds-use-case-gate.ts',
        'use-cases-are-the-only-way-in: src/modules/alpha/infrastructure/alpha.facade.ts',
        'use-cases-are-the-only-way-in: src/modules/alpha/presentation/reaches-application-service.ts',
        'use-cases-are-the-only-way-in: src/modules/beta/index.ts',
      ]);
    });

    it('has a fixture that breaks every rule of the configuration', () => {
      const rules = cruise.summary.ruleSetUsed.forbidden.map((rule) => rule.name);
      const broken = new Set(cruise.summary.violations.map((violation) => violation.rule.name));

      expect(rules.filter((name) => !broken.has(name))).toEqual([]);
    });

    it('lets domain/ import the shared kernel by its package name, through tsconfig paths', () => {
      const domainFile = cruise.modules.find(
        (module) => module.source === 'src/modules/alpha/domain/uses-kernel.ts',
      );

      expect(new Set(domainFile?.dependencies.map((dependency) => dependency.resolved))).toEqual(
        new Set(['packages/shared-kernel/src/index.ts']),
      );
      expect(found.filter((violation) => violation.endsWith('/uses-kernel.ts'))).toEqual([]);
    });

    it.each([
      // The two importers allowed to use the tenant exemption.
      'src/platform/tenant-context/tenant-context.guard.ts',
      'src/platform/health/health.controller.ts',
      // A module reads its tenant through @Tenant().
      'src/modules/alpha/presentation/tenant-controller.ts',
      // Another module through its index.ts; a module's own files.
      'src/modules/alpha/application/allowed-cross-module.ts',
      'src/modules/identity/application/uses-own-domain.ts',
      // identity's Authenticator alone builds authenticated actors (Phase 1).
      'src/modules/identity/application/access/session-authenticator.ts',
      // A module's infrastructure reaches the database through PrismaService only.
      'src/modules/alpha/infrastructure/uses-prisma-service.ts',
      'src/modules/alpha/infrastructure/repository.ts',
      // The connectivity probe is the public face of platform/persistence.
      'src/platform/uses-database-probe.ts',
      // A platform entry adapter builds actors and call contexts.
      'src/platform/scheduler/builds-system-context.ts',
      // platform/authz builds the gate; an entry point reaches application/ through a use
      // case; the module's Nest module binds a repository implementation; a use case reads its
      // repository port.
      'src/platform/authz/authz.module.ts',
      'src/modules/alpha/presentation/calls-use-case.ts',
      'src/modules/alpha/alpha.module.ts',
      'src/modules/alpha/application/use-cases/find-thing.use-case.ts',
      'src/modules/alpha/infrastructure/prisma-thing.repository.ts',
    ])('accepts the allowed file %s', (file) => {
      expect(cruise.modules.map((module) => module.source)).toContain(file);
      expect(found.filter((violation) => violation.endsWith(`: ${file}`))).toEqual([]);
    });
  });

  describe('Prisma boundaries (scripts/check-prisma-boundaries.mjs)', () => {
    const PRISMA_FIXTURES = path.join(FIXTURES, 'prisma');

    /** Runs the real script, as `pnpm boundaries` does; answers its exit code and problems. */
    function checkPrisma(
      schemaDir: string,
      srcDir: string,
    ): { status: number; problems: string[] } {
      try {
        execFileSync(
          process.execPath,
          [path.join(REPO_ROOT, 'scripts/check-prisma-boundaries.mjs'), schemaDir, '--src', srcDir],
          { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return { status: 0, problems: [] };
      } catch (error) {
        const { status, stderr } = error as { status: number; stderr: string };
        const problems = stderr
          .split('\n')
          .filter((line) => line.startsWith('  - '))
          .map((line) => line.slice(4));
        return { status, problems };
      }
    }

    it('accepts the real schema and the real sources', () => {
      expect(
        checkPrisma(path.join(REPO_ROOT, 'prisma/schema'), path.join(API_ROOT, 'src')),
      ).toEqual({ status: 0, problems: [] });
    });

    it('accepts the passing fixture: keys with tenantId (also not leading and name:-named), a composite foreign key, a compound @@id, an exempt model, a UUID @id, raw SQL and the driver in the platform files, identical outboxes, an inbox, the outbox exception and the audit folder', () => {
      expect(
        checkPrisma(
          path.join(PRISMA_FIXTURES, 'passing/schema'),
          path.join(PRISMA_FIXTURES, 'passing/src'),
        ),
      ).toEqual({ status: 0, problems: [] });
    });

    it('rejects every deliberate violation of the failing fixture, and nothing else', () => {
      const { status, problems } = checkPrisma(
        path.join(PRISMA_FIXTURES, 'failing/schema'),
        path.join(PRISMA_FIXTURES, 'failing/src'),
      );

      expect(status).toBe(1);
      expect(problems.sort()).toEqual(
        [
          'alpha.prisma: model AlphaWrongSchema is in schema "beta", but this file owns "alpha"',
          'beta.prisma: enum BetaKind is in schema "alpha", but this file owns "beta"',
          'alpha.prisma: AlphaNeither is neither tenant-scoped (tenantId) nor exempt ("/// @tenant-scope none: <reason>")',
          'alpha.prisma: AlphaBoth has tenantId and also an exemption line',
          'alpha.prisma: AlphaBadKeys @unique on ref does not contain tenantId',
          'alpha.prisma: AlphaBadKeys @@id([kind, code]) does not contain tenantId',
          'alpha.prisma: AlphaBadKeys @@unique([kind, ref]) does not contain tenantId',
          'alpha.prisma: AlphaIntId @id on id does not contain tenantId',
          'alpha.prisma: AlphaChildNoTenant.parent relates two tenant-scoped models without tenantId in both fields and references',
          'alpha.prisma: AlphaChildMisaligned.parent pairs tenantId with another column (tenantId is at different positions in fields and references)',
          'alpha.prisma: AlphaScopedChild.parent relates a tenant-scoped model to the exempt model AlphaExemptParent; exempt and tenant-scoped models may not relate',
          'alpha.prisma: AlphaExemptChild.parent relates an exempt model to the tenant-scoped model AlphaParent; exempt and tenant-scoped models may not relate',
          'beta.prisma: BetaCross.parent relates to AlphaParent in schema "alpha". Relations may not cross module schemas; store the id as a plain column.',
          'modules/alpha/infrastructure/hides-model.ts:9: destructured property "betaThing" names model BetaThing, which belongs to module "beta"',
          'modules/alpha/infrastructure/hides-model.ts:10: destructured property "betaThing" names model BetaThing, which belongs to module "beta"',
          'modules/alpha/infrastructure/hides-model.ts:10: destructured property "platformProbe" names model PlatformProbe, which belongs to module "platform"',
          'modules/alpha/infrastructure/hides-model.ts:11: a computed key on a tx(...) result hides the model it names; name the model as a property',
          'modules/alpha/infrastructure/hides-model.ts:12: a computed key on a tx(...) result hides the model it names; name the model as a property',
          // The audit models are reserved to platform/persistence/audit/ (the AuditWriter).
          'modules/alpha/infrastructure/hides-model.ts:13: destructured property "auditLog" names model AuditLog, which is reserved to platform/persistence/audit/ (write it through AuditWriter)',
          'modules/alpha/infrastructure/hides-model.ts:14: property ".auditLog" names model AuditLog, which is reserved to platform/persistence/audit/ (write it through AuditWriter)',
          'platform/persistence/reaches-module.ts:10: property ".auditLog" names model AuditLog, which is reserved to platform/persistence/audit/ (write it through AuditWriter)',
          'modules/alpha/infrastructure/reaches-beta.ts:2: import of "BetaThing" names model BetaThing, which belongs to module "beta"',
          'modules/alpha/infrastructure/reaches-beta.ts:3: import "../../../generated/prisma/models/BetaThing" names model BetaThing, which belongs to module "beta"',
          'modules/alpha/infrastructure/reaches-beta.ts:3: import of "BetaThingModel" names model BetaThing, which belongs to module "beta"',
          'modules/alpha/infrastructure/reaches-beta.ts:7: type "Prisma.BetaThingWhereInput" names model BetaThing, which belongs to module "beta"',
          'modules/alpha/infrastructure/reaches-beta.ts:8: property ["betaThing"] names model BetaThing, which belongs to module "beta"',
          'modules/alpha/infrastructure/reaches-beta.ts:9: property ".betaThing" names model BetaThing, which belongs to module "beta"',
          'modules/beta/infrastructure/reaches-alpha.ts:5: property ".alphaParent" names model AlphaParent, which belongs to module "alpha"',
          'platform/persistence/reaches-module.ts:9: property ".alphaParent" names model AlphaParent, which belongs to module "alpha"',
          'modules/alpha/infrastructure/raw-forms.ts:7: raw SQL outside the files of RAW_SQL_FILES',
          'modules/alpha/infrastructure/raw-forms.ts:8: raw SQL outside the files of RAW_SQL_FILES',
          'modules/alpha/infrastructure/raw-forms.ts:9: raw SQL outside the files of RAW_SQL_FILES',
          'modules/alpha/infrastructure/raw-forms.ts:10: raw SQL outside the files of RAW_SQL_FILES',
          'modules/alpha/infrastructure/raw-forms.ts:11: raw SQL outside the files of RAW_SQL_FILES',
          'modules/alpha/infrastructure/raw-forms.ts:12: import of the database driver "pg" outside the files of DRIVER_FILES',
          'modules/alpha/infrastructure/raw-forms.ts:13: import of the database driver "pg-pool" outside the files of DRIVER_FILES',
          'modules/alpha/infrastructure/raw-forms.ts:14: require/import() needs a string literal specifier (a computed one could load the database driver)',
          'modules/alpha/infrastructure/raw-forms.ts:18: import of the database driver "postgres" outside the files of DRIVER_FILES',
          'modules/alpha/infrastructure/raw-forms.ts:19: import of the database driver "@prisma/adapter-pg" outside the files of DRIVER_FILES',
          'platform/persistence/reaches-module.ts:11: raw SQL outside the files of RAW_SQL_FILES',
          // Every outbox has the same fields; outbox and inbox models are reserved to
          // platform/persistence/outbox/, which reaches nothing else of a module.
          'beta.prisma: BetaOutbox is an outbox whose fields differ from AlphaOutbox',
          'modules/alpha/infrastructure/writes-own-outbox.ts:6: property ".alphaOutbox" names model AlphaOutbox, which is reserved to platform/persistence/outbox/ (write it through OutboxWriter)',
          'platform/persistence/outbox/reaches-module.ts:7: property ".betaThing" names model BetaThing, which belongs to module "beta"',
        ].sort(),
      );
    });
  });

  describe('the model map generator (scripts/generate-model-map.mjs)', () => {
    const GENERATOR = path.join(REPO_ROOT, 'scripts/generate-model-map.mjs');

    function generate(schemaDir: string): { status: number; output: string } {
      try {
        const output = execFileSync(
          process.execPath,
          [GENERATOR, '--schema', schemaDir, '--json'],
          { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return { status: 0, output };
      } catch (error) {
        const { status, stderr } = error as { status: number; stderr: string };
        return { status, output: stderr };
      }
    }

    it('maps owner, table, scope, relation fields, compound selectors and foreign keys', () => {
      const { status, output } = generate(path.join(FIXTURES, 'prisma/passing/schema'));
      const map = JSON.parse(output) as { models: Record<string, Record<string, unknown>> };

      expect(status).toBe(0);
      expect(map.models.AlphaParent).toEqual({
        module: 'alpha',
        schema: 'alpha',
        table: 'parent',
        clientProperty: 'alphaParent',
        scope: 'scoped',
        scalarFields: ['id', 'tenantId', 'code', 'kind'],
        relationFields: ['children'],
        idField: 'id',
        compoundSelectors: [
          { name: 'tenantId_id', fields: ['tenantId', 'id'] },
          { name: 'byCode', fields: ['tenantId', 'code'] },
          { name: 'kind_tenantId', fields: ['kind', 'tenantId'] },
        ],
        foreignKeys: [],
      });
      expect(map.models.AlphaChild).toMatchObject({
        relationFields: ['parent'],
        foreignKeys: [
          {
            field: 'parent',
            target: 'AlphaParent',
            targetTable: 'parent',
            fields: ['tenantId', 'parentId'],
            references: ['tenantId', 'id'],
            columns: ['tenant_id', 'parent_id'],
            referencedColumns: ['tenant_id', 'id'],
          },
        ],
      });
      expect(map.models.AlphaThrottle).toMatchObject({
        idField: null,
        compoundSelectors: [
          { name: 'tenantId_kind_keyHash', fields: ['tenantId', 'kind', 'keyHash'] },
        ],
      });
      expect(map.models.AlphaLookup).toMatchObject({ scope: 'exempt' });
      expect(map.models.PlatformProbe).toMatchObject({ module: 'platform', scope: 'scoped' });
    });

    it("names each module's outbox and inbox model, by table", () => {
      const { output } = generate(path.join(FIXTURES, 'prisma/passing/schema'));
      const map = JSON.parse(output) as { modules: Record<string, unknown> };

      expect(map.modules).toEqual({
        alpha: { schema: 'alpha', outboxModel: 'AlphaOutbox', inboxModel: null },
        beta: { schema: 'beta', outboxModel: 'BetaOutbox', inboxModel: 'BetaInbox' },
        platform: { schema: 'platform', outboxModel: null, inboxModel: null },
      });
    });

    it('fails on a model with neither scope marker or with both', () => {
      const { status, output } = generate(path.join(FIXTURES, 'prisma/failing/schema'));

      expect(status).toBe(1);
      expect(output).toContain('AlphaNeither has neither tenantId nor');
      expect(output).toContain('AlphaBoth has tenantId and an exemption line');
    });

    it("fails when its parse disagrees with Prisma's DMMF", () => {
      const script = `
        import { buildModelMap, compareWithDmmf } from ${JSON.stringify(pathToFileURL(GENERATOR).href)};
        const map = buildModelMap(${JSON.stringify(path.join(FIXTURES, 'prisma/passing/schema'))});
        const models = Object.keys(map.models).map((name) => ({
          name,
          fields: [...map.models[name].scalarFields.map((f) => ({ name: f, kind: 'scalar', isId: f === map.models[name].idField })),
                   ...map.models[name].relationFields.map((f) => ({ name: f, kind: 'object' }))],
          primaryKey: null,
          uniqueIndexes: map.models[name].compoundSelectors,
        }));
        models.find((m) => m.name === 'AlphaParent').fields.push({ name: 'hidden', kind: 'object' });
        try { compareWithDmmf(map, { datamodel: { models } }); console.log('accepted'); }
        catch (error) { console.log(error.message); }`;
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
      });

      expect(output).toContain('The model map parser disagrees with Prisma');
      expect(output).toContain('AlphaParent: relation fields differ from the DMMF');
    });
  });

  describe('source files', () => {
    // Every lint block names .ts, .mts and .cts, and the dependency-cruiser patterns end in
    // .ts; source of any other kind would escape them. Placeholders and notes are allowed.
    it.each(['apps/api/src', 'packages/shared-kernel/src'])('%s holds only .ts files', (dir) => {
      const others = readdirSync(path.join(REPO_ROOT, dir), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && !entry.name.endsWith('.ts'))
        .filter((entry) => !['.gitkeep', 'README.md'].includes(entry.name))
        .filter((entry) => !entry.parentPath.includes(`${path.sep}generated`))
        .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));

      expect(others).toEqual([]);
    });
  });

  describe('exports of the files platform/ lets others import', () => {
    // persistence-internals-are-private, persistence-root-is-private and
    // tenant-exemption-is-platform-only allow-list these files, so a re-export from them would
    // carry the client or the exemption past the rule.
    it.each([
      ['src/platform/persistence/persistence.module.ts', ['PersistenceModule']],
      ['src/platform/persistence/database-probe.ts', ['DatabaseProbe']],
      // persistence-root-is-private lets module infrastructure import this file only.
      ['src/platform/persistence/prisma.service.ts', ['PrismaService', 'TenantTransaction']],
      // persistence-internals-are-private lets the logger import the error reducer.
      [
        'src/platform/persistence/database-error.ts',
        ['ReducedDatabaseError', 'reduceDatabaseError'],
      ],
      [
        'src/platform/tenant-context/tenant-context.guard.ts',
        ['TenantContextGuard', 'isTenantContextExempt'],
      ],
      ['src/platform/health/health.controller.ts', ['HealthController']],
    ])('%s exports only %j', (file, names) => {
      expect(exportedNames(path.join(API_ROOT, file))).toEqual([...names].sort());
    });

    it('sees a re-export (negative control on a fixture barrel)', () => {
      expect(exportedNames(path.join(FIXTURES, 'src/platform/persistence/index.ts'))).toEqual([
        'PrismaService',
      ]);
    });
  });

  describe('ESLint', () => {
    let eslint: ESLint;
    const results = new Map<string, Linter.LintMessage[]>();
    // With noInlineConfig ESLint adds a warning (no rule id) for every directive it ignores.
    // Those notices are split off here and asserted on their own; every other message must
    // still be an error.
    const ignoredDirectives = new Map<string, string[]>();
    const IGNORED_DIRECTIVE =
      /^'\/\/ eslint-disable[^']*' has no effect because you have 'noInlineConfig'/;

    beforeAll(async () => {
      // One instance and one run over the whole fixture tree: the type-aware parser builds
      // its program once.
      eslint = new ESLint({ cwd: REPO_ROOT, ignore: false });
      const linted = await eslint.lintFiles([
        path.join(FIXTURES, 'src/**/*.ts'),
        path.join(FIXTURES, 'packages/**/*.ts'),
      ]);
      for (const result of linted) {
        const file = path.relative(FIXTURES, result.filePath);
        const notices = result.messages.filter(
          (message) => message.ruleId === null && IGNORED_DIRECTIVE.test(message.message),
        );
        if (notices.length > 0)
          ignoredDirectives.set(
            file,
            notices.map((m) => m.message),
          );
        results.set(
          file,
          result.messages.filter((message) => !notices.includes(message)),
        );
      }
    }, SETUP_TIMEOUT_MS);

    /** The messages of a fixture; each must be an error, so that it fails `pnpm lint`. */
    function messagesIn(file: string): Linter.LintMessage[] {
      const messages = results.get(file);
      if (messages === undefined) throw new Error(`${file} was not linted`);
      expect(messages.filter((message) => message.severity !== 2)).toEqual([]);
      return messages;
    }

    const syntaxOf = (file: string): string[] =>
      textsIn(file).map((text) => text.split(':')[0] ?? text);
    const rulesIn = (file: string): string[] => messagesIn(file).map(label).sort();
    const textsIn = (file: string): string[] => messagesIn(file).map((m) => m.message);

    it('reports every message of every fixture as an error', () => {
      const notErrors = [...results].flatMap(([file, messages]) =>
        messages.filter((message) => message.severity !== 2).map(() => file),
      );

      expect(results.size).toBeGreaterThan(50);
      expect(notErrors).toEqual([]);
    });

    it.each<[string, string[]]>([
      // no-wall-clock: every core layer and the kernel; only platform/clock/ reads it.
      ['src/modules/alpha/domain/wall-clock.ts', syntax('no-wall-clock', 2)],
      ['src/modules/alpha/infrastructure/reads-wall-clock.ts', syntax('no-wall-clock')],
      ['src/platform/reads-wall-clock.ts', syntax('no-wall-clock', 4)],
      ['packages/shared-kernel/src/reads-wall-clock.ts', syntax('no-wall-clock')],
      ['src/platform/clock/system-clock.ts', []],
      // No Date conversion in domain/ and application/; infrastructure/ converts.
      ['src/modules/alpha/domain/converts-date.ts', syntax('no-wall-clock')],
      ['src/modules/alpha/application/converts-date.ts', syntax('no-wall-clock')],
      ['src/modules/alpha/infrastructure/converts-date.ts', []],
      // Raw SQL and $transaction are platform-only; modules never use them.
      [
        'src/modules/alpha/infrastructure/uses-raw-sql.ts',
        syntax('no-raw-sql-or-transaction-in-modules', 6),
      ],
      [
        'src/modules/alpha/application/uses-transaction.ts',
        syntax('no-raw-sql-or-transaction-in-modules'),
      ],
      ['src/platform/uses-raw-sql.ts', []],
      // Only main.ts and platform/worker/ read appRole.
      ['src/platform/reads-app-role.ts', properties('app-role-is-read-in-two-places', 2)],
      [
        'src/modules/alpha/application/reads-app-role.ts',
        properties('app-role-is-read-in-two-places'),
      ],
      ['src/main.ts', []],
      ['src/platform/worker/starts-worker.ts', []],
      // contexts-are-minted-by-platform: the named import and its namespace form, the factory.
      [
        'src/modules/alpha/application/mints-tenant-context.ts',
        [
          ...imports('contexts-are-minted-by-platform', 2),
          ...syntax('contexts-are-minted-by-platform', 3),
        ],
      ],
      // Namespace import, re-export, destructuring (also computed), computed member, qualified
      // type.
      [
        'src/modules/alpha/application/mints-tenant-context-indirectly.ts',
        [
          ...imports('contexts-are-minted-by-platform', 2),
          ...syntax('contexts-are-minted-by-platform', 5),
        ],
      ],
      [
        'src/modules/alpha/application/reexports-kernel.ts',
        imports('contexts-are-minted-by-platform'),
      ],
      [
        'src/modules/alpha/infrastructure/discovers-providers.ts',
        imports('contexts-are-minted-by-platform', 3),
      ],
      [
        'src/modules/alpha/application/asserts-tenant-context.ts',
        syntax('contexts-are-minted-by-platform', 3),
      ],
      ['src/platform/tenant-context/tenant-context.factory.ts', []],
      // The actor and CallContext constructors and types are minted by the platform, and the
      // `contexts` entry is refused by path name.
      [
        'src/modules/alpha/application/mints-actor-context.ts',
        [
          ...imports('contexts-are-minted-by-platform', 2),
          ...syntax('contexts-are-minted-by-platform', 5),
        ],
      ],
      [
        'src/modules/alpha/application/uses-context-types.ts',
        imports('contexts-are-minted-by-platform'),
      ],
      [
        'src/modules/alpha/application/builds-call-context.ts',
        [
          ...imports('contexts-are-minted-by-platform'),
          ...syntax('contexts-are-minted-by-platform'),
        ],
      ],
      // The authenticated-actor constructor is refused in a module (import path and name),
      // except in identity's Authenticator; the platform may name it (the dependency-cruiser
      // rule refuses that import).
      [
        'src/modules/identity/application/mints-authenticated-actor.ts',
        [
          ...imports('contexts-are-minted-by-platform'),
          ...syntax('contexts-are-minted-by-platform'),
        ],
      ],
      ['src/modules/identity/application/access/session-authenticator.ts', []],
      ['src/platform/mints-authenticated-actor.ts', []],
      // use-case-entry-is-the-gate (ADR-0004 decision 4): no execute override in use-cases/;
      // no `handle` reached on another object, by destructuring or by reflection in any file
      // of a module.
      [
        'src/modules/alpha/application/use-cases/overrides-execute.ts',
        syntax('use-case-entry-is-the-gate', 3),
      ],
      [
        'src/modules/alpha/application/use-cases/calls-handle.ts',
        syntax('use-case-entry-is-the-gate', 4),
      ],
      ['src/modules/alpha/presentation/calls-handle.ts', syntax('use-case-entry-is-the-gate')],
      ['src/modules/alpha/application/use-cases/allowed-use-case.ts', []],
      [
        'src/modules/alpha/application/calls-handler-object.ts',
        syntax('use-case-entry-is-the-gate'),
      ],
      [
        'src/modules/alpha/infrastructure/calls-handle.facade.ts',
        syntax('use-case-entry-is-the-gate'),
      ],
      ['src/modules/alpha/application/reflects-handle.ts', syntax('use-case-entry-is-the-gate', 7)],
      // Only the guard attaches a TenantContext, in every part of the API.
      [
        'src/platform/attaches-tenant-context.ts',
        syntax('only-the-guard-attaches-tenant-context', 2),
      ],
      [
        'src/modules/alpha/application/attaches-tenant-context.ts',
        syntax('only-the-guard-attaches-tenant-context'),
      ],
      [
        'src/modules/alpha/presentation/attaches-tenant-context.ts',
        syntax('only-the-guard-attaches-tenant-context'),
      ],
      ['src/attaches-tenant-context.ts', syntax('only-the-guard-attaches-tenant-context')],
      ['src/platform/tenant-context/tenant-context.guard.ts', []],
      ['src/modules/alpha/presentation/tenant-controller.ts', []],
      // Code is loaded by static imports only; modules and the kernel have no import() at all.
      ['src/platform/loads-code-dynamically.ts', syntax('imports-are-static', 5)],
      ['src/modules/alpha/application/imports-kernel-dynamically.ts', syntax('imports-are-static')],
      ['packages/shared-kernel/src/imports-dynamically.ts', syntax('kernel-imports-only-itself')],
      // The kernel imports only itself; time.ts alone imports the polyfill's full build.
      ['packages/shared-kernel/src/imports-outside-itself.ts', kernelImports(5)],
      ['packages/shared-kernel/src/time.ts', []],
      ['packages/shared-kernel/src/index.ts', []],
      // Tenant literals: in a module, in the platform and in the kernel; a word that merely
      // contains one is not refused.
      ['src/modules/alpha/application/hardcoded-tenant.ts', tenantLiterals(3)],
      ['src/platform/hardcoded-tenant.ts', tenantLiterals(2)],
      ['packages/shared-kernel/src/hardcoded-tenant.ts', tenantLiterals()],
      ['src/modules/alpha/application/clean.ts', []],
    ])('%s reports exactly %j', (file, expected) => {
      expect(rulesIn(file)).toEqual([...expected].sort());
    });

    it('names each use-case-entry-is-the-gate message', () => {
      expect(textsIn('src/modules/alpha/application/use-cases/overrides-execute.ts')).toEqual(
        Array(3).fill('use-case-entry-is-the-gate: a use case never overrides execute.'),
      );
      expect(textsIn('src/modules/alpha/application/use-cases/calls-handle.ts')).toEqual(
        Array(4).fill('use-case-entry-is-the-gate: handle is called only by UseCase.execute.'),
      );
      expect(textsIn('src/modules/alpha/application/reflects-handle.ts')).toEqual(
        Array(7).fill(expect.stringMatching(/^use-case-entry-is-the-gate: /)),
      );
    });

    it('names each wall-clock read', () => {
      expect(textsIn('src/platform/reads-wall-clock.ts')).toEqual([
        expect.stringMatching(/^no-wall-clock: new Date\(\) reads/),
        expect.stringMatching(/^no-wall-clock: Date\(\) reads/),
        expect.stringMatching(/^no-wall-clock: Date\.now\(\) reads/),
        expect.stringMatching(/^no-wall-clock: Temporal\.Now reads/),
      ]);
      expect(textsIn('src/modules/alpha/domain/converts-date.ts')).toEqual([
        expect.stringMatching(/^no-wall-clock: no Date in domain\/ or application\//),
      ]);
    });

    it('does not let an inline directive switch a rule off, and reports the ignored directive', () => {
      const file = 'src/modules/alpha/application/disables-a-rule.ts';

      expect(syntaxOf(file)).toEqual(['no-wall-clock']);
      expect([...ignoredDirectives.keys()]).toEqual([file]);
      expect(ignoredDirectives.get(file)).toEqual([
        expect.stringContaining("'// eslint-disable-next-line no-restricted-syntax' has no effect"),
      ]);
    });

    it('names each kernel import it refuses', () => {
      expect(
        textsIn('packages/shared-kernel/src/imports-outside-itself.ts').map(
          (message) => /'([^']+)' import/.exec(message)?.[1],
        ),
      ).toEqual([
        'os',
        'node:path',
        'zod',
        '../../../src/modules/alpha/domain/thing',
        'temporal-polyfill',
      ]);
    });

    it('refuses any other import in time.ts, the basic polyfill build included', async () => {
      const lint = async (code: string): Promise<[number, string][]> => {
        const [result] = await eslint.lintText(code, {
          filePath: path.join(FIXTURES, 'packages/shared-kernel/src/time.ts'),
        });
        return result?.messages.map((message) => [message.severity, label(message)]) ?? [];
      };

      expect(await lint("export { EOL } from 'node:os';\n")).toEqual([
        [2, 'no-restricted-imports: kernel-imports-only-itself'],
      ]);
      expect(await lint("export { Temporal } from 'temporal-polyfill';\n")).toEqual([
        [2, 'no-restricted-imports: kernel-imports-only-itself'],
      ]);
    });

    it('names the tenant literal rule in every message', () => {
      const messages = [
        ...textsIn('src/modules/alpha/application/hardcoded-tenant.ts'),
        ...textsIn('src/platform/hardcoded-tenant.ts'),
        ...textsIn('packages/shared-kernel/src/hardcoded-tenant.ts'),
      ];

      expect(messages).toHaveLength(6);
      expect(messages.every((message) => /^no-tenant-literals: a tenant id/.test(message))).toBe(
        true,
      );
    });
  });
});
