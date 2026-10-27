// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Tenant identifiers that must never appear as literals in core code (ADR-02): a tenant's id,
// locales and time zone are configuration (config/tenants/<id>.json), never a branch or a
// constant in apps/api/src or the shared kernel. The list is read from the checked-in tenant
// files, so a new tenant fixture is banned the moment it is added. Spec files and test/ may
// name the fixtures.
function tenantLiterals() {
  const directory = path.join(import.meta.dirname, 'config/tenants');
  const values = new Set();
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
    const tenant = JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
    for (const value of [tenant.code, tenant.defaultLocale, tenant.timeZone]) values.add(value);
    for (const locale of tenant.supportedLocales ?? []) values.add(locale);
  }
  // esquery's regex literal cannot hold a "/", so a zone's slash matches any character.
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '.');
  return [...values].sort().map(escape).join('|');
}
const TENANT_LITERAL = `(^|[^A-Za-z0-9_-])(${tenantLiterals()})($|[^A-Za-z0-9_-])`;
const TENANT_LITERAL_MESSAGE =
  'no-tenant-literals: a tenant id, locale or time zone is hardcoded in core code. Read it from ' +
  'tenant configuration (TenantRegistry) or receive it in the TenantContext (ADR-02).';
const noTenantLiterals = [
  { selector: `Literal[value=/${TENANT_LITERAL}/]`, message: TENANT_LITERAL_MESSAGE },
  { selector: `TemplateElement[value.raw=/${TENANT_LITERAL}/]`, message: TENANT_LITERAL_MESSAGE },
];

// Boundary rules ported from Mondapac's platform-foundations design 8.2 that ESLint enforces
// (rules 4, 5 and 7) and the attach rule of its slice 0 security review. `no-restricted-syntax` and
// `no-restricted-imports` carry no rule names of their own, so every message starts with the
// design's rule name. Deliberate violations in apps/api/test/boundary-fixtures/ are asserted
// by apps/api/test/boundaries.spec.ts.

// Rule 4, no-wall-clock: only platform/clock/ reads the wall clock (Mondapac ADR-0005).
const WALL_CLOCK = 'take the current time from the injected Clock; only platform/clock/ reads it.';
const noWallClock = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: `no-wall-clock: new Date() reads the wall clock: ${WALL_CLOCK}`,
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: `no-wall-clock: Date() reads the wall clock: ${WALL_CLOCK}`,
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: `no-wall-clock: Date.now() reads the wall clock: ${WALL_CLOCK}`,
  },
  {
    selector: "MemberExpression[object.name='Temporal'][property.name='Now']",
    message: `no-wall-clock: Temporal.Now reads the wall clock: ${WALL_CLOCK}`,
  },
];
// Rule 4, second part: domain/ and application/ use the kernel's Temporal types only; a
// repository converts an Instant with `new Date(value)` (design 3.2).
const noDateConversion = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length>0]",
    message:
      'no-wall-clock: no Date in domain/ or application/: use the Temporal types of the shared ' +
      'kernel. A repository in infrastructure/ converts with new Date(value).',
  },
];

// TypeScript sources of every kind: a block lints only the extensions it names, and
// boundaries.spec.ts checks that apps/api/src and the kernel's src hold no other kind.
const TS = '{ts,mts,cts}';
const SPEC_FILES = [`**/*.spec.${TS}`];
// The fixture tree is outside the globs below, so each block names its fixture files too.
const FIXTURES = 'apps/api/test/boundary-fixtures';

/**
 * Forbids a name however it arrives: a named import (also renamed), a re-export, a member
 * of a namespace import (also computed with a literal), a qualified type name or a
 * destructured property. Matching the name rather than the import path also catches a
 * barrel.
 */
function forbidNames(names, message) {
  const name = `/^(${names.join('|')})$/`;
  return [
    `ImportSpecifier:matches([imported.name=${name}], [imported.value=${name}])`,
    `ExportSpecifier:matches([local.name=${name}], [local.value=${name}])`,
    `MemberExpression:matches([property.name=${name}], [property.value=${name}])`,
    `TSQualifiedName[right.name=${name}]`,
    `ObjectPattern > Property:matches([key.name=${name}], [key.value=${name}])`,
  ].map((selector) => ({ selector, message }));
}

// Rule 5, contexts-are-minted-by-platform: a module never mints a context and never asserts a
// value to a context type; it receives the context from its entry adapter. Lint is a guard
// rail here: a literal can still reach a context parameter through `as any`, a type alias or
// an untyped value, so the run-time control is the kernel's isMinted check. The
// dependency-cruiser rules contexts-are-built-by-platform and
// tenant-context-only-through-the-decorator close the import paths. Identity's Authenticator
// (Phase 1) is exempt for `authenticatedActor` only (the block near the end of this file).
const CONTEXT_CONSTRUCTORS = [
  'mintTenantContext',
  'TenantContextFactory',
  'anonymousActor',
  'systemActor',
  'createCallContext',
  'authenticatedActor',
];
const CONTEXT_TYPES = [
  'TenantContext',
  'ActorContext',
  'AnonymousActor',
  'SystemActor',
  'AuthenticatedActor',
  'CallContext',
];
const MINTED_BY_PLATFORM =
  'contexts-are-minted-by-platform: a module never mints a context; it receives one from ' +
  'its platform entry adapter.';
/** Rule 5's selectors, with the constructors in `allowed` left out. */
const contextsAreMintedByPlatformExcept = (allowed) => [
  ...forbidNames(
    CONTEXT_CONSTRUCTORS.filter((name) => !allowed.includes(name)),
    MINTED_BY_PLATFORM,
  ),
  {
    selector: `:matches(TSAsExpression, TSTypeAssertion) > .typeAnnotation Identifier[name=/^(${CONTEXT_TYPES.join('|')})$/]`,
    message:
      'contexts-are-minted-by-platform: a module never asserts a value to a context type; a ' +
      'context is minted by the platform.',
  },
];
const contextsAreMintedByPlatform = contextsAreMintedByPlatformExcept([]);
// The same rule as import restrictions of the modules (a separate rule key, so the
// no-restricted-syntax blocks do not replace it). With importNames, a namespace import and
// an `export *` of the package are reported too. Provider discovery would hand a module the
// global factory without naming it.
const contextImportPaths = (entries) => [
  'error',
  {
    paths: [
      {
        name: '@phoenix/shared-kernel',
        importNames: ['mintTenantContext'],
        message: MINTED_BY_PLATFORM,
      },
      ...entries.map((name) => ({ name, message: MINTED_BY_PLATFORM })),
      {
        name: '@nestjs/core',
        importNames: ['DiscoveryService', 'DiscoveryModule', 'ModulesContainer', 'ModuleRef'],
        message:
          'contexts-are-minted-by-platform: a module injects what it needs and never ' +
          "discovers providers, the platform's factory included.",
      },
    ],
  },
];
// The actor and CallContext constructors live in the kernel entry `contexts` and the
// authenticated-actor constructor in `authenticated-actor`. A path name match; a module imports
// the context types from the kernel main entry and never these entries.
const contextImportsOfModules = contextImportPaths([
  '@phoenix/shared-kernel/contexts',
  '@phoenix/shared-kernel/authenticated-actor',
]);
const contextImportsOfTheAuthenticator = contextImportPaths(['@phoenix/shared-kernel/contexts']);

// no-raw-sql-or-transaction-in-modules: raw SQL and $transaction belong to the platform
// (UnitOfWork, which also sets the tenant for row-level security); a module reaches the
// database through the unit-of-work port. It is part
// of both module groups below, because a later block replaces the whole rule value.
const noRawSqlOrTransactionInModules = [
  {
    selector:
      'MemberExpression[property.name=/^\\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe|queryRawTyped|transaction)$/]',
    message: 'no-raw-sql-or-transaction-in-modules: Raw SQL and $transaction are platform-only.',
  },
];

// Only TenantContextGuard attaches a request's TenantContext.
const onlyTheGuardAttaches = forbidNames(
  ['attachTenantContext'],
  'only-the-guard-attaches-tenant-context: attachTenantContext is called by ' +
    'TenantContextGuard only; read the tenant with @Tenant().',
);

// imports-are-static: code is loaded by a static
// import only, which pnpm boundaries sees. A computed import(), require, createRequire,
// process.mainModule and a direct eval (which sees the module's require) load code past every
// rule of this file and of dependency-cruiser.
const STATIC_IMPORTS =
  'imports-are-static: load code with a static import, so that pnpm boundaries sees it';
const codeLoaders = [
  { selector: "Identifier[name='require']", message: `${STATIC_IMPORTS} (no require).` },
  ...forbidNames(
    ['createRequire', 'mainModule'],
    `${STATIC_IMPORTS} (no createRequire or mainModule).`,
  ),
  { selector: "CallExpression[callee.name='eval']", message: `${STATIC_IMPORTS} (no eval).` },
];
const staticImportsOnly = [
  {
    selector: "ImportExpression[source.type!='Literal']",
    message: `${STATIC_IMPORTS} (no computed import()).`,
  },
  ...codeLoaders,
];
// Modules have no import() at all: the value of a dynamic import of the kernel, indexed with a
// computed name, would reach mintTenantContext past every name check of rule 5.
const moduleStaticImportsOnly = [
  {
    selector: 'ImportExpression',
    message:
      'imports-are-static: no import() in a module; import statically, so that the context ' +
      'rules see every name.',
  },
  ...codeLoaders,
];
// Rule 7 in the kernel: no import() at all, so the whitelist below cannot be passed by a
// dynamic import of a literal either.
const kernelStaticImportsOnly = [
  {
    selector: 'ImportExpression',
    message:
      'kernel-imports-only-itself: no import() in the shared kernel; import its own files statically.',
  },
  ...codeLoaders,
];

// Rule 7, kernel-imports-only-itself (ADR-01): a whitelist. The kernel imports only its own
// files (`./name`, never `..`); time.ts alone may also import the polyfill's full build. Each
// regex matches what is refused.
const kernelImports = (regex) => [
  'error',
  {
    patterns: [
      {
        regex,
        message:
          'kernel-imports-only-itself: the shared kernel imports only its own files; time.ts ' +
          'alone may import temporal-polyfill/full. No Node API, package or framework.',
      },
    ],
  },
];

// app-role-is-read-in-two-places: only main.ts and platform/worker/ read the process role.
const APP_ROLE_IS_READ_IN_TWO_PLACES = {
  property: 'appRole',
  message: 'app-role-is-read-in-two-places: only main.ts and platform/worker/ read appRole.',
};
// use-case-entry-is-the-gate (ported from Mondapac eslint.config.mjs, slice 1c and slice 2;
// Phoenix ADR-0004 decision 4): UseCase.execute is the one entry that checks the access rule; a
// use case implements the protected `handle` and never overrides `execute` (application/
// use-cases/ only). In every file of src/modules/, a facade, a job or an event handler reaches a
// use case through execute too: no `handle` member on another object, no `handle` destructured,
// no 'handle' named to Reflect, and no reflection over a class's methods (`.prototype`,
// `__proto__`, Object.getPrototypeOf, Object.getOwnPropertyDescriptor(s)). `this.handle(` stays
// allowed (UseCase.execute is in platform/authz/, outside modules). A handler object in a module
// names its method something else.
const GATE = 'use-case-entry-is-the-gate';
const useCaseNeverOverridesExecute = {
  selector:
    "ClassBody > :matches(MethodDefinition, PropertyDefinition):matches([key.name='execute'], [key.value='execute'])",
  message: `${GATE}: a use case never overrides execute.`,
};
const HANDLE_ONLY_BY_EXECUTE = `${GATE}: handle is called only by UseCase.execute.`;
const NO_METHOD_REFLECTION = `${GATE}: no reflection over a class's methods in a module (it reaches handle). Use Object.hasOwn, or a platform helper for plain-object checks; interceptors (CallHandler.handle) live in platform/.`;
const handleIsReachedOnlyByExecute = [
  {
    // The member, not the call, so that x['handle'](), x.handle.call(...) and x.handle.bind(...)
    // are caught too.
    selector:
      "MemberExpression:matches([property.name='handle'], [property.value='handle'])[object.type!='ThisExpression']",
    message: HANDLE_ONLY_BY_EXECUTE,
  },
  {
    selector: "ObjectPattern > Property:matches([key.name='handle'], [key.value='handle'])",
    message: HANDLE_ONLY_BY_EXECUTE,
  },
  {
    selector:
      "CallExpression[callee.object.name='Reflect'] > :matches(Literal[value='handle'], TemplateLiteral > TemplateElement[value.raw='handle'])",
    message: HANDLE_ONLY_BY_EXECUTE,
  },
  {
    selector:
      'CallExpression:matches([callee.name=/^(getPrototypeOf|getOwnPropertyDescriptors?)$/], [callee.property.name=/^(getPrototypeOf|getOwnPropertyDescriptors?)$/])',
    message: NO_METHOD_REFLECTION,
  },
  {
    selector:
      'MemberExpression:matches([property.name=/^(prototype|__proto__)$/], [property.value=/^(prototype|__proto__)$/])',
    message: NO_METHOD_REFLECTION,
  },
];

// The selector groups of the modules block and of the domain and application block.
const MODULE_SYNTAX = [
  ...noTenantLiterals,
  ...noWallClock,
  ...onlyTheGuardAttaches,
  ...contextsAreMintedByPlatform,
  ...noRawSqlOrTransactionInModules,
  ...moduleStaticImportsOnly,
  ...handleIsReachedOnlyByExecute,
];
const domainApplicationSyntax = (contextRules) => [
  ...noTenantLiterals,
  ...noWallClock,
  ...noDateConversion,
  ...onlyTheGuardAttaches,
  ...contextRules,
  ...noRawSqlOrTransactionInModules,
  ...moduleStaticImportsOnly,
  ...handleIsReachedOnlyByExecute,
];
const DOMAIN_APPLICATION_SYNTAX = domainApplicationSyntax(contextsAreMintedByPlatform);

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      // Deliberate violations used by apps/api/test/boundaries.spec.ts.
      '**/test/boundary-fixtures/**',
    ],
  },
  eslint.configs.recommended,
  {
    // No inline directive can switch a boundary rule off in the API sources (nothing there
    // uses one today). The kernel and the fixture trees are covered too.
    files: [
      `apps/api/src/**/*.${TS}`,
      `packages/shared-kernel/src/**/*.${TS}`,
      `${FIXTURES}/src/**/*.${TS}`,
      `${FIXTURES}/packages/shared-kernel/src/**/*.${TS}`,
    ],
    linterOptions: { noInlineConfig: true },
  },
  {
    files: [`**/*.${TS}`],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // no-restricted-syntax: a later block replaces the selectors of an earlier one, so each
  // block lists every group that applies to its files.
  {
    // All code of the API: the attach rule and static imports.
    files: [`apps/api/src/**/*.${TS}`, `${FIXTURES}/src/**/*.${TS}`],
    ignores: SPEC_FILES,
    rules: { 'no-restricted-syntax': ['error', ...onlyTheGuardAttaches, ...staticImportsOnly] },
  },
  {
    // The shared kernel.
    files: [
      `packages/shared-kernel/src/**/*.${TS}`,
      `${FIXTURES}/packages/shared-kernel/src/**/*.${TS}`,
    ],
    ignores: SPEC_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...noTenantLiterals,
        ...noWallClock,
        ...kernelStaticImportsOnly,
      ],
    },
  },
  {
    // Platform runtime.
    files: [`**/src/platform/**/*.${TS}`],
    ignores: SPEC_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...noTenantLiterals,
        ...noWallClock,
        ...onlyTheGuardAttaches,
        ...staticImportsOnly,
      ],
    },
  },
  {
    // The only reader of the wall clock.
    files: [`**/src/platform/clock/**/*.${TS}`],
    ignores: SPEC_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...noTenantLiterals,
        ...onlyTheGuardAttaches,
        ...staticImportsOnly,
      ],
    },
  },
  {
    // The only file that attaches a request's TenantContext.
    files: ['**/src/platform/tenant-context/tenant-context.guard.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...noTenantLiterals, ...noWallClock, ...staticImportsOnly],
    },
  },
  {
    // Modules.
    files: [`**/src/modules/**/*.${TS}`],
    ignores: SPEC_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...MODULE_SYNTAX],
      '@typescript-eslint/no-restricted-imports': contextImportsOfModules,
    },
  },
  {
    // app-role-is-read-in-two-places: only main.ts and platform/worker/ read the process role
    // (APP_ROLE). Every other file receives behaviour, not the role.
    files: [`apps/api/src/**/*.${TS}`, `${FIXTURES}/src/**/*.${TS}`],
    ignores: [
      ...SPEC_FILES,
      'apps/api/src/main.ts',
      'apps/api/src/platform/worker/**',
      `${FIXTURES}/src/main.ts`,
      `${FIXTURES}/src/platform/worker/**`,
    ],
    rules: {
      'no-restricted-properties': ['error', APP_ROLE_IS_READ_IN_TWO_PLACES],
    },
  },
  {
    // The domain and application layers of a module.
    files: [`**/src/modules/*/domain/**/*.${TS}`, `**/src/modules/*/application/**/*.${TS}`],
    ignores: SPEC_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...DOMAIN_APPLICATION_SYNTAX],
    },
  },
  {
    // Use cases: the gate rule joins the domain and application list (a later block replaces
    // the selectors of an earlier one).
    files: [`**/src/modules/*/application/use-cases/**/*.${TS}`],
    ignores: SPEC_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...DOMAIN_APPLICATION_SYNTAX, useCaseNeverOverridesExecute],
    },
  },
  {
    // Identity's Authenticator (Phase 1): the one file that will build an authenticated actor.
    // Only that constructor is exempt; every other rule stays.
    files: [
      'apps/api/src/modules/identity/application/access/session-authenticator.ts',
      `${FIXTURES}/src/modules/identity/application/access/session-authenticator.ts`,
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...domainApplicationSyntax(contextsAreMintedByPlatformExcept(['authenticatedActor'])),
      ],
      '@typescript-eslint/no-restricted-imports': contextImportsOfTheAuthenticator,
    },
  },
  {
    // The shared kernel is framework-free and used by the api and the web apps (ADR-01),
    // spec files included.
    files: [
      `packages/shared-kernel/src/**/*.${TS}`,
      `${FIXTURES}/packages/shared-kernel/src/**/*.${TS}`,
    ],
    rules: { 'no-restricted-imports': kernelImports('^(?!\\./)|\\.\\.') },
  },
  {
    files: ['packages/shared-kernel/src/time.ts', `${FIXTURES}/packages/shared-kernel/src/time.ts`],
    rules: { 'no-restricted-imports': kernelImports('^(?!\\./|temporal-polyfill/full$)|\\.\\.') },
  },
  {
    files: [...SPEC_FILES, `**/test/**/*.${TS}`],
    languageOptions: { globals: { ...globals.jest } },
  },
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
