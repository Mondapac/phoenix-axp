// Licence gate (ADR-0009; Phoenix AXP is proprietary, UNLICENSED). Run by `pnpm licences`, so
// by `pnpm verify` and CI. The policy itself is in scripts/licence-policy.mjs; the reviewed
// exceptions, each approved by `cto`, are in config/licence-exceptions.json.
//
// It reads `pnpm licenses list --json` twice for the whole workspace: the full tree (dev
// dependencies included, ADR-0009 decision 3) and the production closure (`--prod`), which
// tells a shipped package from a dev-only one.
//
// Usage: node scripts/check-licences.mjs
//          [--all-json <file>] [--prod-json <file>] [--exceptions <file>]
// (the --*-json flags read saved listings instead of running pnpm; used by the tests)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLicences } from './licence-policy.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function listing(savedFile, prodOnly) {
  if (savedFile !== undefined) return JSON.parse(readFileSync(savedFile, 'utf8'));
  const output = execFileSync(
    'pnpm',
    ['licenses', 'list', ...(prodOnly ? ['--prod'] : []), '--json'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    },
  );
  return JSON.parse(output);
}

const exceptionsFile =
  option('--exceptions') ?? path.join(REPO_ROOT, 'config/licence-exceptions.json');
let exceptions;
try {
  exceptions = JSON.parse(readFileSync(exceptionsFile, 'utf8'));
} catch (error) {
  console.error(`Cannot read ${exceptionsFile}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

/** The SHA-256 of the licence file of an installed package, or null when it has none. */
function licenceFileHash(dir) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE']) {
    const file = path.join(dir, name);
    if (existsSync(file)) return createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return null;
}

const result = checkLicences({
  all: listing(option('--all-json'), false),
  production: listing(option('--prod-json'), true),
  exceptions,
  licenceFileHash,
});

for (const line of result.applied) console.log(`exception: ${line}`);
if (result.failures.length > 0) {
  console.error(
    `Licence check failed (ADR-0009): ${result.failures.length} problem(s):\n` +
      result.failures.map((line) => `  - ${line}`).join('\n'),
  );
  process.exit(1);
}
console.log(
  `Licences hold: ${result.total} package licence(s) in the full tree ` +
    `(${result.production} in production), ${result.applied.length} reviewed exception(s).`,
);
