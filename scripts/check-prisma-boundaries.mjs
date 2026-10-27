// Persistence boundaries (ADR-0001, ADR-0002, ADR-0003). Run by `pnpm boundaries`, so by
// `pnpm verify` and CI; fixtures in apps/api/test/boundary-fixtures/prisma/ are asserted by
// apps/api/test/boundaries.spec.ts.
//
// Schema checks (prisma/schema/*.prisma, read by scripts/prisma-schema.mjs):
//   - <module>.prisma declares models and enums in schema "<module>" only (dashes become
//     underscores); base.prisma declares none; no relation crosses schemas;
//   - every model is tenant-scoped (tenantId) or exempt ("/// @tenant-scope none: <reason>"),
//     never neither or both;
//   - every @id, @unique, @@id, @@unique and @@index of a scoped model leads with tenantId
//     (ADR-0002 decision 3), except the single-column UUID @id (a UUIDv7 is unique across
//     tenants; the exemption ADR-0002 names);
//   - the tenantId field of a scoped model maps to the column "tenant_id", the column the
//     row-level security policies and their database test read;
//   - every @relation between two scoped models has tenantId in both `fields` and
//     `references`, at the same position; a scoped and an exempt model never relate.
// Source check, "model to owning module", on apps/api/src/modules/<m>/infrastructure/ and
// apps/api/src/platform/persistence/: every reference to a Prisma model names a model of the
// file's own module (platform/ owns platform.prisma). A reference is a property of the model's
// client name (`.isolationProbe`, `["isolationProbe"]` or a destructured `{ isolationProbe }`),
// a `Prisma.<Model>...` name, a name imported from the generated client that starts with a model
// name, or an import from its `models/` folder. A non-literal key on the result of a `tx(...)`
// call (`tx(t)[key]`, `const { [key]: d } = tx(t)`) is refused, because it hides the model it
// names.
// Raw SQL: raw SQL members (`$queryRaw`, `$executeRaw` and their Unsafe/Typed forms) and the
// `pg` driver are used only by the files in RAW_SQL_FILES and DRIVER_FILES. A reviewed raw-read
// port for modules (Mondapac ADR-0030) is deferred; see docs/platform-deferred.md.
//
// Usage: node scripts/check-prisma-boundaries.mjs [schema-dir] [--src <apps/api/src>]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { readPrismaSchema } from './prisma-schema.mjs';

/** The calls whose result is a model view: `PrismaService.tx(tenant)`. */
const VIEW_CALLS = ['tx'];

/** The only files (relative to the source root) that may run raw SQL. */
const RAW_SQL_FILES = new Set([
  'platform/persistence/database-probe.ts',
  'platform/persistence/guarded-client.ts',
  'platform/persistence/prisma-root.ts',
  'platform/persistence/prisma-unit-of-work.ts',
  'platform/persistence/session-statements.ts',
  'platform/persistence/tenant-guard.ts',
]);
/** The only files that may import the database driver. */
const DRIVER_FILES = new Set(['platform/persistence/prisma-root.ts']);
const DRIVER_SPECIFIER = /^(pg|pg-[^/]+|postgres|@prisma\/adapter-pg)(\/.*)?$/;
const RAW_SQL_MEMBER =
  /^\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe|queryRawTyped|extends)$/;
const PRISMA_RAW_BUILDERS = new Set(['sql', 'raw', 'join']);

const args = process.argv.slice(2);
const srcFlag = args.indexOf('--src');
const srcDir = path.resolve(srcFlag >= 0 ? args[srcFlag + 1] : 'apps/api/src');
const positional = args.filter(
  (arg, index) => !arg.startsWith('--') && args[index - 1] !== '--src',
);
const schemaDir = path.resolve(positional[0] ?? 'prisma/schema');

const { models, enums, problems } = readPrismaSchema(schemaDir);
const byName = new Map(models.map((model) => [model.name, model]));
const isScoped = (model) => model.hasTenantId;

// --- Module schemas.
for (const block of [...models.map((m) => ({ ...m, kind: 'model' })), ...enums]) {
  const expectedSchema = path.basename(block.file, '.prisma').replaceAll('-', '_');
  if (block.file === 'base.prisma') {
    problems.push(`${block.file}: ${block.kind} ${block.name} must live in its module's own file`);
  } else if (block.schema === undefined) {
    problems.push(
      `${block.file}: ${block.kind} ${block.name} has no @@schema("${expectedSchema}")`,
    );
  } else if (block.schema !== expectedSchema) {
    problems.push(
      `${block.file}: ${block.kind} ${block.name} is in schema "${block.schema}", but this file ` +
        `owns "${expectedSchema}"`,
    );
  }
}

for (const model of models) {
  // --- No relation crosses a module schema.
  for (const field of model.fields.filter((f) => f.relation)) {
    const target = byName.get(field.type);
    if (target.schema !== model.schema) {
      problems.push(
        `${model.file}: ${model.name}.${field.name} relates to ${field.type} in schema ` +
          `"${target.schema}". Relations may not cross module schemas; store the id as a plain column.`,
      );
    }
  }

  // --- Scope (ADR-0002).
  if (isScoped(model) && model.exemptionReason !== undefined) {
    problems.push(`${model.file}: ${model.name} has tenantId and also an exemption line`);
  } else if (!isScoped(model) && model.exemptionReason === undefined) {
    problems.push(
      `${model.file}: ${model.name} is neither tenant-scoped (tenantId) nor exempt ` +
        '("/// @tenant-scope none: <reason>")',
    );
  }

  // --- Every key and index of a scoped model leads with tenantId (ADR-0002 decision 3).
  if (isScoped(model)) {
    const tenantField = model.fields.find((f) => f.name === 'tenantId');
    if (tenantField.column !== 'tenant_id') {
      problems.push(
        `${model.file}: ${model.name}.tenantId maps to column "${tenantField.column}", ` +
          'expected "tenant_id"',
      );
    }
    for (const key of [...model.keys, ...model.indexes]) {
      if (key.fields[0] === 'tenantId') continue;
      const field = model.fields.find((f) => f.name === key.fields[0]);
      const uuidId =
        key.kind === 'id' &&
        key.single &&
        field?.type === 'String' &&
        field.attributes.some((a) => a.name === 'db.Uuid');
      if (!uuidId) {
        const label =
          key.single && key.kind !== 'index'
            ? `@${key.kind} on ${key.fields[0]}`
            : `@@${key.kind}([${key.fields.join(', ')}])`;
        problems.push(`${model.file}: ${model.name} ${label} does not lead with tenantId`);
      }
    }
  }

  // --- A relation between scoped models carries tenantId on both sides, aligned.
  for (const relation of model.relations) {
    const target = byName.get(relation.target);
    if (!target) continue;
    // An exempt model and a scoped model never relate, in either direction: the guard reads
    // no tenant on the exempt side, so a relation would carry rows across tenants.
    if (isScoped(model) !== isScoped(target)) {
      problems.push(
        `${model.file}: ${model.name}.${relation.field} relates ` +
          `${isScoped(model) ? 'a tenant-scoped' : 'an exempt'} model to ` +
          `${isScoped(target) ? 'the tenant-scoped' : 'the exempt'} model ${target.name}; ` +
          'exempt and tenant-scoped models may not relate',
      );
      continue;
    }
    if (!isScoped(model)) continue;
    const from = relation.fields.indexOf('tenantId');
    const to = relation.references.indexOf('tenantId');
    if (from < 0 || to < 0) {
      problems.push(
        `${model.file}: ${model.name}.${relation.field} relates two tenant-scoped models without ` +
          'tenantId in both fields and references',
      );
    } else if (from !== to) {
      problems.push(
        `${model.file}: ${model.name}.${relation.field} pairs tenantId with another column ` +
          '(tenantId is at different positions in fields and references)',
      );
    }
  }
}

// --- Model to owning module, and raw SQL.
if (existsSync(srcDir)) problems.push(...checkModelOwnership(srcDir));
if (existsSync(srcDir)) problems.push(...checkRawSql(srcDir));

if (problems.length > 0) {
  console.error(
    `Prisma boundary violations:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`Prisma boundaries hold (${models.length} model(s) checked).`);

/** The owning module of a source file, or undefined when the rule does not look at it. */
function moduleOfFile(relative) {
  const inModule = /^modules\/([^/]+)\/infrastructure\//.exec(relative);
  if (inModule) return inModule[1];
  if (relative.startsWith('platform/persistence/')) return 'platform';
  return undefined;
}

function sourceFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|mts|cts)$/.test(entry.name))
    .filter((entry) => !/\.spec\.(ts|mts|cts)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

function checkModelOwnership(root) {
  const found = [];
  const byClientProperty = new Map(models.map((model) => [model.clientProperty, model]));
  // Longest name first, so `ProbeEntry` is not read as `Probe` + `Entry`.
  const names = models.map((model) => model.name).sort((a, b) => b.length - a.length);
  const modelOfTypeName = (name) =>
    names.find(
      (model) =>
        name === model || (name.startsWith(model) && /^[A-Z_]/.test(name.slice(model.length))),
    );
  const isGenerated = (specifier) => /(^|\/)generated\/prisma(\/|$)/.test(specifier);

  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const owner = moduleOfFile(relative);
    if (owner === undefined) continue;
    const source = parse(file);
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

    const report = (node, model, how) => {
      if (model.module === owner) return;
      found.push(
        `${relative}:${lineOf(node)}: ${how} names model ${model.name}, which belongs to ` +
          `module "${model.module}"`,
      );
    };

    /** Whether `node` is a `tx(...)` call, under any parentheses. */
    const isViewCall = (node) => {
      while (node && ts.isParenthesizedExpression(node)) node = node.expression;
      if (!node || !ts.isCallExpression(node)) return false;
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      return VIEW_CALLS.includes(name);
    };
    const reportComputed = (node) =>
      found.push(
        `${relative}:${lineOf(node)}: a computed key on a tx(...) result hides the model it ` +
          'names; name the model as a property',
      );

    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node)) {
        const model = byClientProperty.get(node.name.text);
        if (model) report(node.name, model, `property ".${node.name.text}"`);
        if (ts.isIdentifier(node.expression) && node.expression.text === 'Prisma') {
          const name = modelOfTypeName(node.name.text);
          if (name) report(node.name, byName.get(name), `"Prisma.${node.name.text}"`);
        }
      } else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        const model = byClientProperty.get(node.argumentExpression.text);
        if (model)
          report(node.argumentExpression, model, `property ["${node.argumentExpression.text}"]`);
      } else if (ts.isElementAccessExpression(node) && isViewCall(node.expression)) {
        reportComputed(node.argumentExpression);
      } else if (ts.isObjectBindingPattern(node)) {
        const initializer = ts.isVariableDeclaration(node.parent)
          ? node.parent.initializer
          : undefined;
        for (const element of node.elements) {
          const key = element.propertyName ?? element.name;
          const literal =
            ts.isComputedPropertyName(key) && ts.isStringLiteralLike(key.expression)
              ? key.expression
              : key;
          if (ts.isIdentifier(literal) || ts.isStringLiteralLike(literal)) {
            const model = byClientProperty.get(literal.text);
            if (model) report(literal, model, `destructured property "${literal.text}"`);
          } else if (ts.isComputedPropertyName(literal) && isViewCall(initializer)) {
            reportComputed(literal);
          }
        }
      } else if (
        ts.isQualifiedName(node) &&
        ts.isIdentifier(node.left) &&
        node.left.text === 'Prisma'
      ) {
        const name = modelOfTypeName(node.right.text);
        if (name) report(node.right, byName.get(name), `type "Prisma.${node.right.text}"`);
      } else if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isGenerated(node.moduleSpecifier.text)
      ) {
        const specifier = node.moduleSpecifier.text;
        const fromModels = /generated\/prisma\/models\/(\w+)$/.exec(specifier);
        if (fromModels && byName.has(fromModels[1])) {
          report(node.moduleSpecifier, byName.get(fromModels[1]), `import "${specifier}"`);
        }
        const bindings = ts.isImportDeclaration(node)
          ? node.importClause?.namedBindings
          : node.exportClause;
        const elements = bindings && 'elements' in bindings ? bindings.elements : [];
        for (const element of elements) {
          const imported = (element.propertyName ?? element.name).text;
          const name = modelOfTypeName(imported);
          if (name) report(element, byName.get(name), `import of "${imported}"`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** Raw SQL members and the database driver only in the files of RAW_SQL_FILES and DRIVER_FILES. */
function checkRawSql(root) {
  const found = [];
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const source = parse(file);
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const rawSqlAllowed = RAW_SQL_FILES.has(relative);
    const driverAllowed = DRIVER_FILES.has(relative);
    const rawSqlMessage = (node) =>
      `${relative}:${lineOf(node)}: raw SQL outside the files of RAW_SQL_FILES`;
    const isLoaderCall = (node) =>
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'));
    const visit = (node) => {
      if (!rawSqlAllowed) {
        if (ts.isPropertyAccessExpression(node)) {
          const onPrisma = ts.isIdentifier(node.expression) && node.expression.text === 'Prisma';
          if (
            RAW_SQL_MEMBER.test(node.name.text) ||
            (onPrisma && PRISMA_RAW_BUILDERS.has(node.name.text))
          ) {
            found.push(rawSqlMessage(node));
          }
        } else if (
          ts.isElementAccessExpression(node) &&
          ts.isStringLiteralLike(node.argumentExpression) &&
          RAW_SQL_MEMBER.test(node.argumentExpression.text)
        ) {
          found.push(rawSqlMessage(node));
        } else if (ts.isBindingElement(node)) {
          const key = node.propertyName ?? node.name;
          const literal = ts.isComputedPropertyName(key) ? key.expression : key;
          const text =
            ts.isIdentifier(literal) || ts.isStringLiteralLike(literal) ? literal.text : undefined;
          if (text !== undefined && RAW_SQL_MEMBER.test(text)) found.push(rawSqlMessage(node));
        }
      }
      if (!driverAllowed) {
        let specifier;
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          specifier = node.moduleSpecifier.text;
        } else if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference) &&
          ts.isStringLiteralLike(node.moduleReference.expression)
        ) {
          specifier = node.moduleReference.expression.text;
        } else if (
          isLoaderCall(node) &&
          node.arguments[0] &&
          ts.isStringLiteralLike(node.arguments[0])
        ) {
          specifier = node.arguments[0].text;
        }
        if (
          isLoaderCall(node) &&
          !(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
        ) {
          found.push(
            `${relative}:${lineOf(node)}: require/import() needs a string literal specifier ` +
              '(a computed one could load the database driver)',
          );
        }
        if (specifier !== undefined && DRIVER_SPECIFIER.test(specifier)) {
          found.push(
            `${relative}:${lineOf(node)}: import of the database driver "${specifier}" ` +
              'outside the files of DRIVER_FILES',
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}
