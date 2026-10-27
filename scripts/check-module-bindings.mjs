// Module bindings name their own module (security review S5-1). Run by `pnpm boundaries`, so by
// `pnpm verify` and CI; fixtures in apps/api/test/boundary-fixtures/bindings/ are asserted by
// apps/api/test/boundaries.spec.ts.
//
// A module reaches its own outbox writer, audit writer, subscriptions, audit actions,
// permissions and jobs by passing its name to one of these calls:
//   PersistenceModule.outboxWriterFor(<module>)    PersistenceModule.auditWriterFor(<module>)
//   registerSubscriptionsFrom(<module>, ...)       registerAuditActions(<module>, ...)
//   registerPermissions(<module>, ...)             registerJobsFrom(<module>, ...)
// The name decides whose events, audit actions, inbox slots and permission keys the caller
// gets, so a module that passed another module's name could forge that module's audit trail or
// events. The rule:
//   - in src/modules/<m>/**, the first argument is the string literal '<m>';
//   - in src/platform/**, it is 'platform' or 'platform.<component>';
//   - anywhere else in src/ (the composition root included) these calls are refused;
//   - the argument is always a plain string literal, never a variable or a template;
//   - the six names are only called, never passed around, aliased or imported under another
//     name, so every use is a call this check can read.
// Spec files are not checked: tests bind any module on purpose.
//
// Usage: node scripts/check-module-bindings.mjs [--src <apps/api/src>]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** The calls that bind a module by name (a static method of PersistenceModule, or a function). */
const BINDINGS = new Set([
  'outboxWriterFor',
  'auditWriterFor',
  'registerSubscriptionsFrom',
  'registerAuditActions',
  'registerPermissions',
  'registerJobsFrom',
]);
const PLATFORM_NAME = /^platform(\.[a-z][a-z0-9-]*)?$/;

const args = process.argv.slice(2);
const srcFlag = args.indexOf('--src');
const srcDir = path.resolve(srcFlag >= 0 ? args[srcFlag + 1] : 'apps/api/src');

function sourceFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|mts|cts)$/.test(entry.name))
    .filter((entry) => !/\.spec\.(ts|mts|cts)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/** Who may bind in a file: a module name, the platform, or nobody. */
function ownerOf(relative) {
  const inModule = /^modules\/([^/]+)\//.exec(relative);
  if (inModule) return { kind: 'module', name: inModule[1] };
  if (relative.startsWith('platform/')) return { kind: 'platform' };
  return { kind: 'none' };
}

/** Whether `node` is the name of a declaration (the definition of a binding, not a use). */
function isDeclarationName(node) {
  const parent = node.parent;
  return (
    (ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  );
}

const problems = [];
for (const file of sourceFiles(srcDir)) {
  const relative = path.relative(srcDir, file).split(path.sep).join('/');
  const owner = ownerOf(relative);
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const report = (node, message) => problems.push(`${relative}:${lineOf(node)}: ${message}`);

  /** Checks one call of a binding; `name` is the binding's name. */
  const checkCall = (call, name) => {
    const first = call.arguments[0];
    if (owner.kind === 'none') {
      report(call, `${name}(...) outside a module and outside platform/; a module binds itself`);
      return;
    }
    if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
      report(call, `${name}(...) needs a string literal module name as its first argument`);
      return;
    }
    if (owner.kind === 'module' && first.text !== owner.name) {
      report(
        first,
        `${name}('${first.text}') in module "${owner.name}"; a module binds only its own ` +
          `name ('${owner.name}')`,
      );
    } else if (owner.kind === 'platform' && !PLATFORM_NAME.test(first.text)) {
      report(
        first,
        `${name}('${first.text}') in platform/; the platform binds only 'platform' or ` +
          `'platform.<component>'`,
      );
    }
  };

  const visit = (node) => {
    // Import or export of a binding under another name hides its calls.
    if (
      (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) &&
      node.propertyName &&
      BINDINGS.has(node.propertyName.text) &&
      node.name.text !== node.propertyName.text
    ) {
      report(node, `${node.propertyName.text} is imported or exported under another name`);
    }

    const name = ts.isIdentifier(node)
      ? node.text
      : ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent)
        ? node.text
        : undefined;
    if (name !== undefined && BINDINGS.has(name)) {
      const parent = node.parent;
      const inSpecifier = ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent);
      if (!inSpecifier && !isDeclarationName(node)) {
        // The expression that names the binding: `f`, `X.f` or `X['f']`.
        const reference =
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isElementAccessExpression(parent) && parent.argumentExpression === node)
            ? parent
            : node;
        const call = reference.parent;
        if (ts.isCallExpression(call) && call.expression === reference) {
          checkCall(call, name);
        } else {
          report(node, `${name} is used without being called; call it directly`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length > 0) {
  console.error(
    `Module binding violations:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
  );
  process.exit(1);
}
console.log('Module bindings hold: every binding names its own module.');
