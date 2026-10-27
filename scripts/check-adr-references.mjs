// ADR references use Phoenix's four-digit numbers (`ADR-0010`), and the template's are written
// `Mondapac ADR-0030`. A two-digit reference (the "ADR" prefix with two digits) came from the
// Phase 0 working notes and points at the wrong Phoenix ADR (QA review 2.4), so it fails
// `pnpm lint`.
// Applied migrations are skipped: a merged migration is never edited (ADR-0003 decision 6).
//
// Usage: node scripts/check-adr-references.mjs [<file> ...]   (default: every tracked file)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIPPED = [
  /^prisma\/migrations\//,
  /^pnpm-lock\.yaml$/,
  /\.(png|jpe?g|gif|ico|woff2?)$/,
  // Its own test, whose samples are the refused forms.
  /^apps\/api\/test\/adr-references\.spec\.ts$/,
];
const BAD_REFERENCE = /\bADRs?[- ](\d{1,3}|\d{5,})(?!\d)/g;

const args = process.argv.slice(2);
const files =
  args.length > 0
    ? args
    : execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((file) => file !== '' && !SKIPPED.some((pattern) => pattern.test(file)));

const problems = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(path.resolve(REPO_ROOT, file), 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(BAD_REFERENCE)) {
      problems.push(`${file}:${index + 1}: "${match[0]}" is not a four-digit ADR number`);
    }
  });
}

if (problems.length > 0) {
  console.error(
    `ADR references must use four digits (ADR-0010; Mondapac ADR-0030 for the template):\n` +
      problems.map((problem) => `  - ${problem}`).join('\n'),
  );
  process.exit(1);
}
console.log(`ADR references hold (${files.length} file(s) checked).`);
