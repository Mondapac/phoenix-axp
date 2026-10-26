// Licence gate for production dependencies (Phoenix AXP is proprietary, UNLICENSED). Run by
// `pnpm licences`, so by `pnpm verify` and CI.
//
// It reads `pnpm licenses list --prod --json` for the whole workspace and checks every
// package's declared licence (an SPDX id or expression):
//   - ALLOWED licences pass;
//   - WARNED licences (MPL-2.0: file-level copyleft, fine for unmodified use) pass with a
//     warning, so a reviewer sees them;
//   - every other licence fails, the families named in DENIED included (GPL, AGPL, LGPL,
//     SSPL, BUSL, the Sustainable Use and Elastic licences; ADR-13), unless the package is in
//     REVIEWED with a reason.
// An SPDX expression passes when one alternative of an OR passes, and an AND only when every
// part passes. A package with no licence field fails.
//
// Usage: node scripts/check-licences.mjs [--json <file>]   (--json reads a saved listing)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'BlueOak-1.0.0',
]);
const WARNED = new Set(['MPL-2.0']);
/** Refused whatever REVIEWED says: incompatible with a proprietary, closed-source product. */
const DENIED = /^(A?GPL|LGPL|SSPL|BUSL|SUL|Elastic|CC-BY-NC|CC-BY-SA|EUPL|OSL|CPAL|RPL)/i;

/**
 * Packages whose licence is outside ALLOWED and was reviewed, by name. Each entry names the
 * licence it was reviewed for: a new version under another licence fails again.
 */
const REVIEWED = new Map([
  [
    'argparse',
    {
      licence: 'Python-2.0',
      reason: 'permissive (PSF licence); reached through js-yaml from @nestjs/swagger',
    },
  ],
  [
    'postgres',
    {
      licence: 'Unlicense',
      reason: 'public-domain dedication; reached through the prisma CLI, a peer of @prisma/client',
    },
  ],
  [
    'robust-predicates',
    { licence: 'Unlicense', reason: 'public-domain dedication; reached through Prisma Studio' },
  ],
  [
    'elkjs',
    {
      licence: 'EPL-2.0',
      reason:
        'weak (file-level) copyleft, used unmodified by Prisma Studio (prisma CLI, a peer of ' +
        '@prisma/client); not linked into the API. Revisit if the prisma CLI leaves the ' +
        'production closure',
    },
  ],
]);

function listing() {
  const flag = process.argv.indexOf('--json');
  if (flag >= 0) return readFileSync(process.argv[flag + 1], 'utf8');
  return execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** 'pass' | 'warn' | 'fail' for one SPDX id. */
function verdictOfId(id) {
  const bare = id.replace(/\+$/, '').replace(/-or-later$|-only$/, '');
  if (DENIED.test(bare)) return 'fail';
  if (ALLOWED.has(id)) return 'pass';
  if (WARNED.has(id)) return 'warn';
  return 'fail';
}

const RANK = { pass: 0, warn: 1, fail: 2 };

/** The verdict of an SPDX expression: AND takes the worst part, OR the best alternative. */
function verdictOf(expression) {
  const text = expression.trim().replace(/^\((.*)\)$/, '$1');
  const alternatives = text.split(/\s+OR\s+/i);
  if (alternatives.length > 1) {
    return alternatives.map(verdictOf).sort((a, b) => RANK[a] - RANK[b])[0];
  }
  const parts = text.split(/\s+AND\s+/i);
  if (parts.length > 1) {
    return parts.map(verdictOf).sort((a, b) => RANK[b] - RANK[a])[0];
  }
  return verdictOfId(text.replace(/[()]/g, ''));
}

const byLicence = JSON.parse(listing());
const failures = [];
const warnings = [];
const reviewed = [];
let count = 0;

for (const [licence, packages] of Object.entries(byLicence)) {
  for (const pkg of packages) {
    count += 1;
    const label = `${pkg.name}@${pkg.versions.join(',')} (${licence})`;
    const verdict = licence === 'Unknown' ? 'fail' : verdictOf(licence);
    if (verdict === 'pass') continue;
    if (verdict === 'warn') {
      warnings.push(label);
      continue;
    }
    const review = REVIEWED.get(pkg.name);
    const bare = licence.replace(/\+$/, '');
    if (review && review.licence === licence && !DENIED.test(bare)) {
      reviewed.push(`${label}: ${review.reason}`);
    } else {
      failures.push(label);
    }
  }
}

for (const line of reviewed) console.log(`reviewed: ${line}`);
for (const line of warnings) console.warn(`warning: ${line} needs a look (MPL-2.0 is allowed)`);
if (failures.length > 0) {
  console.error(
    `Licence check failed: ${failures.length} production package(s) under a licence that is ` +
      `not allowed:\n${failures.map((line) => `  - ${line}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(
  `Licences hold: ${count} production package(s), ${warnings.length} warning(s), ` +
    `${reviewed.length} reviewed exception(s).`,
);
