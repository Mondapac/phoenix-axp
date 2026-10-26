// Architecture boundaries of the modular monolith, enforced in CI (ADR-01). Ported from
// Mondapac's configuration with its marketplace-specific rules dropped. Paths are relative to
// apps/api; the shared kernel, reached through the `paths` of tsconfig.json, appears as
// `../../packages/shared-kernel/...`. Every rule has a deliberate violation in
// test/boundary-fixtures/, asserted by test/boundaries.spec.ts.

// The one file that will build authenticated actors: identity's Authenticator (Phase 1).
const AUTHENTICATOR_FILE = 'src/modules/identity/application/access/session-authenticator\\.ts';

// The file of `@NoTenantContext()` and the only files that may import it: the guard reads the
// exemption, the health controller uses it. Both files export only their own names (asserted
// in boundaries.spec.ts).
const TENANT_EXEMPTION_FILE = '^src/platform/tenant-context/no-tenant-context\\.decorator\\.ts$';
const TENANT_EXEMPTION_IMPORTERS = [
  '^src/platform/tenant-context/tenant-context\\.guard\\.ts$',
  '^src/platform/health/health\\.controller\\.ts$',
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'platform-does-not-import-modules',
      comment:
        'platform/ is below the modules: it may not import any module, not even through its ' +
        "index.ts. Modules implement platform's ports instead.",
      severity: 'error',
      from: { path: '^src/platform/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'temporal-only-through-kernel',
      comment:
        'Temporal comes from @phoenix/shared-kernel only. The pattern matches the bare ' +
        'specifier, because pnpm does not resolve the polyfill from apps/api, and also a ' +
        'resolved path, should hoisting ever change.',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '(^|/node_modules/)(temporal-polyfill|@js-temporal/polyfill)(/|$)' },
    },
    {
      name: 'tenant-exemption-is-platform-only',
      comment:
        'Only the tenant guard and the health controller may import @NoTenantContext(): only ' +
        'health and docs are exempt from tenant resolution (ADR-02). An allow-list of ' +
        'importers, so that a re-export cannot carry the exemption elsewhere.',
      severity: 'error',
      from: { pathNot: TENANT_EXEMPTION_IMPORTERS },
      to: { path: TENANT_EXEMPTION_FILE },
    },
    {
      name: 'tenant-context-only-through-the-decorator',
      comment:
        'A module takes its tenant from @Tenant() and imports nothing else from ' +
        'platform/tenant-context/ or platform/health/: no factory, module, guard, exemption or ' +
        'health controller.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: {
        path: '^src/platform/(tenant-context|health)/',
        pathNot: '^src/platform/tenant-context/tenant\\.decorator\\.ts$',
      },
    },
    {
      name: 'tenant-context-is-attached-by-the-guard',
      comment:
        'The request-to-tenant map is imported only by TenantContextGuard, which attaches a ' +
        "request's tenant, and by the @Tenant() decorator file, which reads it.",
      severity: 'error',
      from: {
        pathNot: [
          '^src/platform/tenant-context/tenant-context\\.guard\\.ts$',
          '^src/platform/tenant-context/tenant\\.decorator\\.ts$',
        ],
      },
      to: { path: '^src/platform/tenant-context/attached-tenant-context\\.ts$' },
    },
    {
      name: 'request-actor-is-attached-by-the-actor-guard',
      comment:
        "The request-to-actor map is imported only by ActorGuard, which attaches a request's " +
        'actor, and by the @Call() decorator file, which builds the CallContext from it.',
      severity: 'error',
      from: {
        pathNot: [
          '^src/platform/call-context/actor\\.guard\\.ts$',
          '^src/platform/call-context/call-context\\.decorator\\.ts$',
        ],
      },
      to: { path: '^src/platform/call-context/request-actor\\.ts$' },
    },
    {
      name: 'kernel-testing-only-in-tests',
      comment:
        'The fakes of @phoenix/shared-kernel/testing are never bound in a running process: ' +
        'src/ (spec files are excluded) and the kernel itself may not import them. The subpath ' +
        "resolves through tsconfig.json's paths to the kernel's src/testing.ts; dist/ and the " +
        'bare specifier are matched as well.',
      severity: 'error',
      from: { path: ['^src/', 'packages/shared-kernel/src/'] },
      to: {
        path: [
          'packages/shared-kernel/src/testing\\.ts$',
          'packages/shared-kernel/dist/testing\\.(js|d\\.ts)$',
          '^@phoenix/shared-kernel/testing$',
        ],
      },
    },
    {
      name: 'kernel-only-through-package-entries',
      comment:
        'Outside the kernel, code reaches it only by its package names (@phoenix/shared-kernel ' +
        'and its /testing, /contexts and /authenticated-actor entries), never by a path into ' +
        'its src/ or dist/ and never by a deeper subpath: minting must stay inside the kernel, ' +
        'in one copy per process.',
      severity: 'error',
      from: { pathNot: 'packages/shared-kernel/' },
      to: {
        path: [
          'packages/shared-kernel/(src|dist)/',
          '^@phoenix/shared-kernel/(?!(testing|contexts|authenticated-actor)$)',
        ],
        // The package names resolve through tsconfig.json's paths, which marks them aliased.
        dependencyTypesNot: ['aliased'],
      },
    },
    {
      name: 'contexts-are-built-by-platform',
      comment:
        'Only the platform entry adapters build actors and call contexts: nothing outside ' +
        'src/platform/ imports @phoenix/shared-kernel/contexts. A module receives its ' +
        'CallContext from the adapter that called it; it never mints a system actor.',
      severity: 'error',
      from: { pathNot: ['^src/platform/', 'packages/shared-kernel/'] },
      to: {
        path: [
          'packages/shared-kernel/src/contexts\\.ts$',
          'packages/shared-kernel/dist/contexts\\.(js|d\\.ts)$',
          '^@phoenix/shared-kernel/contexts$',
        ],
      },
    },
    {
      name: 'authenticated-actor-is-built-by-the-authenticator',
      comment:
        "Only identity's Authenticator (Phase 1), the one file that builds actors from a valid " +
        'session, imports @phoenix/shared-kernel/authenticated-actor. No other module, no other ' +
        'file of identity and no platform code mints an authenticated actor.',
      severity: 'error',
      from: { pathNot: [`^${AUTHENTICATOR_FILE}$`, 'packages/shared-kernel/'] },
      to: {
        path: [
          'packages/shared-kernel/src/authenticated-actor\\.ts$',
          'packages/shared-kernel/dist/authenticated-actor\\.(js|d\\.ts)$',
          '^@phoenix/shared-kernel/authenticated-actor$',
        ],
      },
    },
    {
      name: 'module-public-api-only',
      comment: "A module may import another module only through that module's index.ts.",
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'module-internals-are-private',
      comment: 'Code outside modules/ may import a module only through its index.ts.',
      severity: 'error',
      from: { pathNot: '^src/modules/' },
      to: { path: '^src/modules/[^/]+/', pathNot: '^src/modules/[^/]+/index\\.ts$' },
    },
    {
      name: 'domain-is-pure',
      comment:
        'domain/ holds pure business rules: it may import only its own domain/ and the ' +
        'shared kernel. No NestJS, no Prisma, no I/O, no other layer.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/domain/' },
      // The kernel arrives through tsconfig.json's paths (positive fixture: domain/uses-kernel.ts).
      to: { pathNot: ['^src/modules/$1/domain/', 'packages/shared-kernel/'] },
    },
    {
      name: 'application-does-not-know-delivery',
      comment: 'application/ defines ports; it may not import infrastructure/ or presentation/.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/application/' },
      to: { path: '^src/modules/[^/]+/(infrastructure|presentation)/' },
    },
    {
      name: 'prisma-only-in-infrastructure',
      comment:
        'The Prisma client is imported only from modules/<m>/infrastructure/ and ' +
        'platform/persistence/.',
      severity: 'error',
      from: {
        pathNot: [
          '^src/modules/[^/]+/infrastructure/',
          '^src/platform/persistence/',
          '^src/generated/',
        ],
      },
      to: { path: ['^src/generated/', 'node_modules/@prisma/'] },
    },
    {
      name: 'persistence-internals-are-private',
      comment:
        'PrismaService is the door to the database. Outside modules/<m>/infrastructure/ and ' +
        'platform/persistence/, code may import only PersistenceModule, DatabaseProbe and ' +
        'the error reducer (it imports no Prisma) from platform/persistence/, so a re-export ' +
        'cannot leak the client.',
      severity: 'error',
      from: { pathNot: ['^src/modules/[^/]+/infrastructure/', '^src/platform/persistence/'] },
      to: {
        path: '^src/platform/persistence/',
        pathNot:
          '^src/platform/persistence/(persistence\\.module|database-probe|database-error)\\.ts$',
      },
    },
    {
      name: 'persistence-root-is-private',
      comment:
        "A module's infrastructure/ imports nothing of platform/persistence/ but " +
        'prisma.service.ts: never the base client (PrismaRoot), the guarded client, the unit ' +
        'store, the session statements or the guard, so its only door to the database is ' +
        'tx(tenant).',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/infrastructure/' },
      to: {
        path: '^src/platform/persistence/',
        pathNot: '^src/platform/persistence/prisma\\.service\\.ts$',
      },
    },
    {
      name: 'database-driver-only-in-infrastructure',
      comment: 'The PostgreSQL driver is used only by infrastructure/ and platform/persistence/.',
      severity: 'error',
      from: {
        pathNot: [
          '^src/modules/[^/]+/infrastructure/',
          '^src/platform/persistence/',
          '^src/generated/',
        ],
      },
      to: { path: 'node_modules/(pg|pg-[^/]+|@types/pg)/' },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies hide coupling between files and modules.',
      severity: 'error',
      from: { pathNot: '^src/generated/' },
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.spec\\.ts$' },
  },
};
