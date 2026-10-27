import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import {
  accessDeclarationOf,
  type AccessDeclaration,
  type AccessRuleKind,
} from '../../src/platform/authz/access-rule';
import {
  isPermissionCatalogue,
  populationOfScope,
  type PermissionScope,
} from '../../src/platform/authz/permission';
import { UseCase } from '../../src/platform/authz/use-case';

// Ported from Mondapac apps/api/test/authz/use-case-discovery.ts. Phoenix changes: no seller
// state (its two problems and the `allow` list entries are gone, so the list holds every
// non-permission rule); a rule's keys must all be of one population (platform keys, or tenant
// and site keys), not of one scope; a tree without `modules/` has no use case and no key.
//
// The discovery and CI check of Phoenix ADR-0004 decision 4 (Mondapac identity design 5.2;
// platform-foundations 6.4 rows 3 to 6). It reads a source tree twice: statically, through the TypeScript type checker, to find
// every class that derives from `UseCase` wherever it sits and whether it derives directly; and
// at run time, by loading each use-case file, to read the declarations exactly as the gate
// reads them (an own static `access`, HF4). Pure: it returns problems and never throws for a
// broken tree, so the fixtures can assert each problem.

const API_ROOT = path.resolve(__dirname, '../..');
const USE_CASE_SOURCE = path.join(API_ROOT, 'src/platform/authz/use-case.ts');
const JOB_REGISTRY_SOURCE = path.join(API_ROOT, 'src/platform/scheduler/job-registry.ts');
/** Where a module's entry points live (identity design 5.2; security review of slice 1c, L2). */
const PRESENTATION_PATH = /^modules\/[^/]+\/presentation\//;

/** `modules/<module>/application/use-cases/<stem>.use-case.ts`, nothing nested. */
const USE_CASE_PATH = /^modules\/([^/]+)\/application\/use-cases\/([^/]+)\.use-case\.ts$/;
/** A file stem as the second segment of a use-case name. */
const STEM_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type DiscoveryProblemCode =
  | 'use-cases-folder-misplaced'
  | 'file-misnamed'
  | 'use-case-file-misplaced'
  | 'use-case-outside-glob'
  | 'extends-use-case'
  | 'execute-overridden'
  | 'controller-outside-presentation'
  | 'job-outside-presentation'
  | 'export-count'
  | 'declaration-invalid'
  | 'name-mismatch'
  | 'name-duplicate'
  | 'catalogue-module-mismatch'
  | 'key-declared-twice'
  | 'key-retired'
  | 'key-undeclared'
  | 'keys-span-scopes'
  | 'list-entry-missing'
  | 'list-entry-stale';

export interface DiscoveryProblem {
  /** Relative to the scanned source root, with `/` separators. */
  readonly file: string;
  readonly code: DiscoveryProblemCode;
  readonly detail?: string;
}

/**
 * One entry of the checked-in list (platform-foundations 6.2 row 5): every declaration whose
 * rule is not `permissions`, so each `anonymous`, `own-resources` and `system` use case is seen
 * in review.
 */
export interface ListedDeclaration {
  readonly name: string;
  readonly rule: AccessRuleKind;
}

export interface DiscoveredUseCase {
  readonly file: string;
  readonly module: string;
  readonly declaration: AccessDeclaration;
}

export interface DiscoveryResult {
  readonly useCases: readonly DiscoveredUseCase[];
  readonly problems: readonly DiscoveryProblem[];
}

export interface DiscoveryInput {
  /** The source root that holds `modules/` (the API's `src/`, or a fixture tree). */
  readonly sourceRoot: string;
  /** The checked-in list of non-permission and `allow` declarations. */
  readonly listed: readonly ListedDeclaration[];
  /** The checked-in list of retired permission keys (platform-foundations 6.1 row 4). */
  readonly retiredKeys: readonly string[];
}

const toPosix = (file: string): string => file.split(path.sep).join('/');

/** Every `.ts` source file below `directory`, without tests and declaration files. */
function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(full);
    }
  }
  return files.sort();
}

/** Where a file sits relative to the `use-cases` convention (HF4). */
function placementProblems(relative: string): DiscoveryProblem[] {
  const segments = relative.split('/');
  const folders = segments.slice(0, -1);
  const fileName = segments[segments.length - 1]!;
  const match = USE_CASE_PATH.exec(relative);
  if (match !== null) {
    return STEM_PATTERN.test(match[2]!)
      ? []
      : [{ file: relative, code: 'file-misnamed', detail: fileName }];
  }
  const useCasesAt = folders.indexOf('use-cases');
  if (useCasesAt !== -1) {
    const placed = useCasesAt === 3 && folders[0] === 'modules' && folders[2] === 'application';
    return placed
      ? [{ file: relative, code: 'file-misnamed', detail: fileName }]
      : [{ file: relative, code: 'use-cases-folder-misplaced' }];
  }
  if (fileName.endsWith('.use-case.ts'))
    return [{ file: relative, code: 'use-case-file-misplaced' }];
  return [];
}

function isUseCaseSymbol(symbol: ts.Symbol | undefined): boolean {
  return (
    symbol?.getName() === 'UseCase' &&
    (symbol.declarations ?? []).some(
      (declaration) =>
        ts.isClassDeclaration(declaration) &&
        path.resolve(declaration.getSourceFile().fileName) === USE_CASE_SOURCE,
    )
  );
}

/** The direct base types of a class, through intersections (a mixin) too. */
function baseTypes(checker: ts.TypeChecker, type: ts.Type): ts.Type[] {
  if (!(type.flags & ts.TypeFlags.Object)) return [];
  const target = (type as ts.TypeReference).target ?? type;
  if (!((target as ts.ObjectType).objectFlags & ts.ObjectFlags.ClassOrInterface)) return [];
  const bases = checker.getBaseTypes(target);
  return bases.flatMap((base) => (base.isIntersection() ? base.types : [base]));
}

/** 'direct' when a base is `UseCase` itself, 'indirect' further up, null when not a use case. */
function derivation(checker: ts.TypeChecker, type: ts.Type): 'direct' | 'indirect' | null {
  const seen = new Set<ts.Type>();
  let level = baseTypes(checker, type);
  let depth = 0;
  while (level.length > 0) {
    if (level.some((base) => isUseCaseSymbol(base.getSymbol()))) {
      return depth === 0 ? 'direct' : 'indirect';
    }
    const next: ts.Type[] = [];
    for (const base of level) {
      if (seen.has(base)) continue;
      seen.add(base);
      next.push(...baseTypes(checker, base));
    }
    level = next;
    depth += 1;
  }
  return null;
}

/** True for a `@Controller(...)` decorator of `@nestjs/common` on a class. */
function isControllerDecorator(checker: ts.TypeChecker, decorator: ts.Decorator): boolean {
  const call = decorator.expression;
  if (!ts.isCallExpression(call)) return false;
  let symbol = checker.getSymbolAtLocation(call.expression);
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return (
    symbol?.getName() === 'Controller' &&
    (symbol.declarations ?? []).some((declaration) =>
      declaration.getSourceFile().fileName.includes('@nestjs/common'),
    )
  );
}

/** True for an object literal that the type checker reads as a `JobDefinition`. */
function isJobDefinition(checker: ts.TypeChecker, node: ts.ObjectLiteralExpression): boolean {
  const contextual = checker.getContextualType(node);
  const symbol = contextual?.getSymbol() ?? contextual?.aliasSymbol;
  return (
    symbol?.getName() === 'JobDefinition' &&
    (symbol.declarations ?? []).some(
      (declaration) => path.resolve(declaration.getSourceFile().fileName) === JOB_REGISTRY_SOURCE,
    )
  );
}

/** The static half: every class that derives from `UseCase`, in any file of the tree. */
function staticProblems(sourceRoot: string, files: readonly string[]): DiscoveryProblem[] {
  const configPath = path.join(API_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, API_ROOT);
  const program = ts.createProgram({ rootNames: files, options: { ...options, noEmit: true } });
  const checker = program.getTypeChecker();
  const problems: DiscoveryProblem[] = [];

  for (const file of files) {
    if (path.resolve(file) === USE_CASE_SOURCE) continue;
    const source = program.getSourceFile(file);
    if (source === undefined) continue;
    const relative = toPosix(path.relative(sourceRoot, file));
    const inGlob = USE_CASE_PATH.test(relative);
    // L2: in a module, controllers and job definitions are entry points and sit in
    // presentation/, where rule 9 limits what they import. Event handlers join with slice 3.
    const outsidePresentation =
      relative.startsWith('modules/') && !PRESENTATION_PATH.test(relative);

    const visit = (node: ts.Node): void => {
      if (outsidePresentation && ts.isClassDeclaration(node)) {
        const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
        if (decorators.some((decorator) => isControllerDecorator(checker, decorator))) {
          problems.push({
            file: relative,
            code: 'controller-outside-presentation',
            detail: node.name?.text ?? '(anonymous class)',
          });
        }
      }
      if (
        outsidePresentation &&
        ts.isObjectLiteralExpression(node) &&
        isJobDefinition(checker, node)
      ) {
        problems.push({ file: relative, code: 'job-outside-presentation' });
      }
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        // A class expression's type is its constructor; its instance type is what derives.
        const type = checker.getTypeAtLocation(node);
        const constructs = type.getConstructSignatures();
        const instance = constructs.length > 0 ? constructs[0]!.getReturnType() : type;
        const kind = derivation(checker, instance);
        if (kind !== null) {
          const name = node.name?.text ?? '(anonymous class)';
          if (!inGlob)
            problems.push({ file: relative, code: 'use-case-outside-glob', detail: name });
          if (kind === 'indirect') {
            problems.push({ file: relative, code: 'extends-use-case', detail: name });
          }
          const overrides = node.members.some(
            (member) =>
              member.name !== undefined &&
              ts.isIdentifier(member.name) &&
              member.name.text === 'execute' &&
              !ts.isPropertyDeclaration(member),
          );
          if (overrides)
            problems.push({ file: relative, code: 'execute-overridden', detail: name });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return problems;
}

const isUseCaseClass = (value: unknown): value is abstract new (...args: never[]) => object =>
  typeof value === 'function' && value.prototype instanceof UseCase;

/** The run-time half for one use-case file: its one exported class and its declaration. */
function loadUseCase(
  file: string,
  relative: string,
  module: string,
  stem: string,
): { useCase?: DiscoveredUseCase; problems: DiscoveryProblem[] } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loads each discovered file
  const exported = require(file) as Record<string, unknown>;
  const classes = [...new Set(Object.values(exported).filter(isUseCaseClass))];
  if (classes.length !== 1) {
    return {
      problems: [{ file: relative, code: 'export-count', detail: String(classes.length) }],
    };
  }
  const useCase = classes[0]!;
  // A class that extends another use case is reported by the static half.
  if (Object.getPrototypeOf(useCase) !== UseCase) return { problems: [] };
  const problems: DiscoveryProblem[] = [];
  if (Object.hasOwn(useCase.prototype as object, 'execute')) {
    problems.push({ file: relative, code: 'execute-overridden', detail: useCase.name });
  }
  const declared = accessDeclarationOf(useCase);
  if (!declared.ok) {
    problems.push({ file: relative, code: 'declaration-invalid', detail: declared.error.code });
    return { problems };
  }
  const expected = `${module}.${stem}`;
  if (declared.value.name !== expected) {
    problems.push({
      file: relative,
      code: 'name-mismatch',
      detail: `${declared.value.name} (expected ${expected})`,
    });
  }
  return { useCase: { file: relative, module, declaration: declared.value }, problems };
}

/** Every key declared in a module's `contracts/index.ts`, with its scope. */
function declaredKeys(
  sourceRoot: string,
  retiredKeys: readonly string[],
): { scopes: Map<string, PermissionScope>; problems: DiscoveryProblem[] } {
  const scopes = new Map<string, PermissionScope>();
  const problems: DiscoveryProblem[] = [];
  const modulesDir = path.join(sourceRoot, 'modules');
  // Phoenix: before the first module lands, `src/` has no `modules/` folder.
  if (!existsSync(modulesDir)) return { scopes, problems };
  const modules = readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const retired = new Set(retiredKeys);
  for (const module of modules) {
    const contracts = path.join(modulesDir, module, 'contracts/index.ts');
    const relative = toPosix(path.relative(sourceRoot, contracts));
    let exported: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- reads each catalogue
      exported = require(contracts) as Record<string, unknown>;
    } catch {
      continue; // A module without contracts declares no key.
    }
    for (const catalogue of Object.values(exported).filter(isPermissionCatalogue)) {
      if (catalogue.module !== module) {
        problems.push({
          file: relative,
          code: 'catalogue-module-mismatch',
          detail: catalogue.module,
        });
        continue;
      }
      for (const { key, scope } of catalogue.declarations) {
        if (scopes.has(key))
          problems.push({ file: relative, code: 'key-declared-twice', detail: key });
        if (retired.has(key)) problems.push({ file: relative, code: 'key-retired', detail: key });
        scopes.set(key, scope);
      }
    }
  }
  return { scopes, problems };
}

/**
 * Keys of a `permissions` rule: declared, and of one population (Phoenix ADR-0004 decision 7):
 * no actor holds a platform key and a tenant or site key, so such a rule admits nobody.
 */
function ruleProblems(
  useCase: DiscoveredUseCase,
  scopes: ReadonlyMap<string, PermissionScope>,
): DiscoveryProblem[] {
  const { declaration, file } = useCase;
  if (declaration.rule.kind !== 'permissions') return [];
  const problems: DiscoveryProblem[] = [];
  const populations = new Set<string>();
  for (const key of declaration.rule.allOf) {
    const scope = scopes.get(key);
    if (scope === undefined) problems.push({ file, code: 'key-undeclared', detail: key });
    else populations.add(populationOfScope(scope));
  }
  if (populations.size > 1) problems.push({ file, code: 'keys-span-scopes' });
  return problems;
}

/** The entry a declaration needs in the checked-in list, or null when it needs none. */
export function listEntryOf(declaration: AccessDeclaration): ListedDeclaration | null {
  const { name, rule } = declaration;
  return rule.kind === 'permissions' ? null : { name, rule: rule.kind };
}

const entryKey = (entry: ListedDeclaration): string => JSON.stringify([entry.name, entry.rule]);

/** Runs every check of ADR-0004 decision 4 over one source tree. */
export function discoverUseCases(input: DiscoveryInput): DiscoveryResult {
  const { sourceRoot, listed, retiredKeys } = input;
  const files = sourceFiles(sourceRoot);
  const moduleFiles = files.filter((file) =>
    toPosix(path.relative(sourceRoot, file)).startsWith('modules/'),
  );
  const problems: DiscoveryProblem[] = [];
  const useCases: DiscoveredUseCase[] = [];

  for (const file of moduleFiles)
    problems.push(...placementProblems(toPosix(path.relative(sourceRoot, file))));
  problems.push(...staticProblems(sourceRoot, files));

  for (const file of moduleFiles) {
    const relative = toPosix(path.relative(sourceRoot, file));
    const match = USE_CASE_PATH.exec(relative);
    if (match === null || !STEM_PATTERN.test(match[2]!)) continue;
    const loaded = loadUseCase(file, relative, match[1]!, match[2]!);
    problems.push(...loaded.problems);
    if (loaded.useCase !== undefined) useCases.push(loaded.useCase);
  }

  const names = new Map<string, number>();
  for (const { declaration } of useCases) {
    names.set(declaration.name, (names.get(declaration.name) ?? 0) + 1);
  }
  for (const useCase of useCases) {
    if (names.get(useCase.declaration.name)! > 1) {
      problems.push({
        file: useCase.file,
        code: 'name-duplicate',
        detail: useCase.declaration.name,
      });
    }
  }

  const keys = declaredKeys(sourceRoot, retiredKeys);
  problems.push(...keys.problems);
  for (const useCase of useCases) problems.push(...ruleProblems(useCase, keys.scopes));

  // The checked-in list, both ways: a new entry and a removed one each fail until it changes.
  const expected = new Map<string, DiscoveredUseCase>();
  for (const useCase of useCases) {
    const entry = listEntryOf(useCase.declaration);
    if (entry !== null) expected.set(entryKey(entry), useCase);
  }
  const listedKeys = new Set(listed.map(entryKey));
  for (const [key, useCase] of expected) {
    if (!listedKeys.has(key)) {
      problems.push({
        file: useCase.file,
        code: 'list-entry-missing',
        detail: useCase.declaration.name,
      });
    }
  }
  for (const entry of listed) {
    if (!expected.has(entryKey(entry))) {
      problems.push({ file: '(checked-in list)', code: 'list-entry-stale', detail: entry.name });
    }
  }

  // The static and run-time halves can report the same overridden `execute`: keep one.
  const unique = new Map(problems.map((problem) => [JSON.stringify(problem), problem]));
  return { useCases, problems: [...unique.values()] };
}

/** Reads a checked-in JSON list. */
export function readList<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}
