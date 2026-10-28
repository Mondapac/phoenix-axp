// Panel boundary check (ADR-0001 decision 5; the frontend rules of .claude/agents/
// frontend-developer.md): the panels (apps/admin, apps/studio, apps/portal) and their packages
// (packages/ui, packages/panel-server) reach the core only through their BFF.
//
// Rules, each proven on apps/api/test/boundary-fixtures/panels/ by
// apps/api/test/panel-boundaries.spec.ts:
// - panel-server-is-server-only: a client module ('use client') imports neither
//   @phoenix/panel-server, next/headers nor a panel's `_server/` folder, and packages/ui
//   never imports @phoenix/panel-server.
// - no-core-imports: no panel code imports the API (apps/api, @phoenix/api).
// - no-cross-panel-imports: a panel imports no other panel.
// - client-reads-no-env: a client module reads no process.env (nothing of the server's
//   configuration reaches the browser bundle).
// - browser-calls-own-origin: a client module fetches no absolute URL; it calls its own BFF.
// - no-tenant-literals: no tenant id, locale or time zone of config/tenants/ is written in panel
//   code (ADR-0002); specs and their `test-*` fixture files may name the fixtures.
//
// Usage: node scripts/check-panel-boundaries.mjs [--root <dir>] [--json]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANELS = ['admin', 'studio', 'portal'];
const PANEL_PACKAGES = ['ui', 'panel-server'];
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
// Specs and their fixtures (`test-*.ts` beside them) may name the tenant fixtures.
const SPEC = /(\.spec|[\\/]test-[\w-]+)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  'lint',
  'scripts',
]);

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) files.push(...sourceFiles(full));
    } else if (SOURCE.test(entry) && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Tenant ids, locales and time zones of the checked-in tenant files. */
function tenantLiterals(root) {
  const directory = path.join(root, 'config/tenants');
  const values = new Set();
  if (!existsSync(directory)) return values;
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
    const tenant = JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
    for (const value of [tenant.code, tenant.defaultLocale, tenant.timeZone]) values.add(value);
    for (const locale of tenant.supportedLocales ?? []) values.add(locale);
  }
  return values;
}

function isClientModule(source) {
  const first = source.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client'
  );
}

/** Every module specifier: static and dynamic imports, re-exports and require(). */
function importsOf(source) {
  const found = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The panel or panel package a path is in, as `apps/<x>` or `packages/<x>`, or null. */
function areaOf(root, file) {
  const relative = path.relative(root, file).split(path.sep);
  if (relative[0] === 'apps' && relative[1] !== undefined) return `apps/${relative[1]}`;
  if (relative[0] === 'packages' && relative[1] !== undefined) return `packages/${relative[1]}`;
  return null;
}

/** The violations of the panel boundary rules under `root`. */
export function checkPanelBoundaries(root = REPO_ROOT) {
  const violations = [];
  const literals = tenantLiterals(root);
  const report = (rule, file, detail) =>
    violations.push({ rule, file: path.relative(root, file).split(path.sep).join('/'), detail });
  const files = [
    ...PANELS.flatMap((panel) => sourceFiles(path.join(root, 'apps', panel))),
    ...PANEL_PACKAGES.flatMap((name) => sourceFiles(path.join(root, 'packages', name, 'src'))),
  ];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const area = areaOf(root, file);
    const client = isClientModule(source);
    const spec = SPEC.test(file);

    for (const specifier of importsOf(source)) {
      const resolved = specifier.startsWith('.')
        ? path.resolve(path.dirname(file), specifier)
        : null;
      const target = resolved === null ? null : areaOf(root, resolved);
      if (
        specifier === '@phoenix/api' ||
        specifier.startsWith('@phoenix/api/') ||
        target === 'apps/api'
      ) {
        report('no-core-imports', file, specifier);
      }
      const otherPanel = PANELS.find(
        (panel) =>
          `apps/${panel}` !== area &&
          (specifier === `@phoenix/${panel}` ||
            specifier.startsWith(`@phoenix/${panel}/`) ||
            target === `apps/${panel}`),
      );
      if (otherPanel !== undefined) report('no-cross-panel-imports', file, specifier);
      const serverOnly =
        specifier === '@phoenix/panel-server' ||
        specifier.startsWith('@phoenix/panel-server/') ||
        target === 'packages/panel-server' ||
        specifier === 'next/headers' ||
        /(^|\/)_server(\/|$)/.test(specifier);
      if (serverOnly && (client || area === 'packages/ui')) {
        report('panel-server-is-server-only', file, specifier);
      }
    }

    const visit = (node) => {
      if (
        client &&
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process' &&
        node.name.text === 'env'
      ) {
        report('client-reads-no-env', file, 'process.env');
      }
      if (
        client &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'fetch' &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(node.arguments[0].text)
      ) {
        report('browser-calls-own-origin', file, node.arguments[0].text);
      }
      if (
        !spec &&
        (ts.isStringLiteralLike(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node) ||
          ts.isTemplateHead(node)) &&
        literals.size > 0
      ) {
        for (const value of literals) {
          const at = node.text.indexOf(value);
          if (at < 0) continue;
          const before = node.text[at - 1];
          const after = node.text[at + value.length];
          if (!/[A-Za-z0-9_-]/.test(before ?? '') && !/[A-Za-z0-9_-]/.test(after ?? '')) {
            report('no-tenant-literals', file, value);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

function main(argv) {
  const rootAt = argv.indexOf('--root');
  const root = rootAt >= 0 ? path.resolve(argv[rootAt + 1] ?? '.') : REPO_ROOT;
  const violations = checkPanelBoundaries(root);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(violations)}\n`);
  } else if (violations.length === 0) {
    console.log('check-panel-boundaries: no violation');
  } else {
    for (const v of violations) console.error(`${v.rule}: ${v.file} (${v.detail})`);
    console.error(`check-panel-boundaries: ${violations.length} violation(s)`);
  }
  return violations.length === 0 ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
