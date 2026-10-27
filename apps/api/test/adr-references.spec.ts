import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// scripts/check-adr-references.mjs (part of `pnpm lint`): two-digit ADR references point at the
// wrong Phoenix ADR, so only four-digit ones pass (QA review 2.4).

const CHECK = path.resolve(__dirname, '../../../scripts/check-adr-references.mjs');

describe('the ADR reference check (scripts/check-adr-references.mjs)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'adr-references-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function check(text: string): { status: number; problems: string[] } {
    const file = path.join(dir, 'sample.ts');
    writeFileSync(file, text);
    try {
      execFileSync(process.execPath, [CHECK, file], { stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, problems: [] };
    } catch (error) {
      const { status, stderr } = error as { status: number; stderr: Buffer };
      const problems = stderr
        .toString()
        .split('\n')
        .filter((line) => line.startsWith('  - '))
        .map((line) => line.slice(line.indexOf(': "') + 2));
      return { status, problems };
    }
  }

  it('accepts four-digit Phoenix and Mondapac references', () => {
    expect(check('// ADR-0010 decision 1, ADR-0002 and Mondapac ADR-0030\n')).toEqual({
      status: 0,
      problems: [],
    });
  });

  it('refuses two-digit, three-digit and five-digit references', () => {
    expect(check('// ADR-12 ("defer"), ADR 02, ADR-009 and ADR-00100\n')).toEqual({
      status: 1,
      problems: [
        '"ADR-12" is not a four-digit ADR number',
        '"ADR 02" is not a four-digit ADR number',
        '"ADR-009" is not a four-digit ADR number',
        '"ADR-00100" is not a four-digit ADR number',
      ],
    });
  });
});
